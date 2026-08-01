/**
 * LSCI Tag Co-occurrence Network — three.js 三维可视化
 * 数据由 functions.php 通过 wp_localize_script 注入到 window.LSCI_TAG_NETWORK
 * 结构：{ nodes: [{id, name, slug, description, count, link}], edges: [{source, target, weight}] }
 */
(function () {
	'use strict';

	var DATA = window.LSCI_TAG_NETWORK || { nodes: [], edges: [] };
	if (!DATA.nodes || !DATA.nodes.length) {
		return;
	}

	var container = document.getElementById('lsci-tag-network');
	if (!container || typeof THREE === 'undefined') {
		return;
	}

	// ---- 配色（浅色洁净科研风：绿 / 蓝绿）----
	var COLOR_A = new THREE.Color('#2e9e5b'); // 生命科学绿
	var COLOR_B = new THREE.Color('#1b9e9e'); // 蓝绿
	var EDGE_BASE = new THREE.Color('#9ec9bf');

	// ---- 场景 / 相机 / 渲染器 ----
	var scene = new THREE.Scene();
	scene.background = new THREE.Color('#ffffff');
	scene.fog = new THREE.Fog('#ffffff', 60, 180);

	var width = container.clientWidth || window.innerWidth;
	var height = container.clientHeight || Math.round(window.innerHeight * 0.78);

	var camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
	camera.position.set(0, 0, 90);

	var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setSize(width, height);
	container.appendChild(renderer.domElement);

	// ---- 光照 ----
	scene.add(new THREE.AmbientLight(0xffffff, 0.85));
	var dir = new THREE.DirectionalLight(0xffffff, 0.6);
	dir.position.set(40, 60, 80);
	scene.add(dir);

	// ---- OrbitControls（旋转 / 缩放）----
	var controls = new THREE.OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.rotateSpeed = 0.6;
	controls.minDistance = 30;
	controls.maxDistance = 260;
	controls.autoRotate = true;
	controls.autoRotateSpeed = 0.45;

	// ---- 节点坐标：确定性球面斐波那契分布 ----
	var nodes = DATA.nodes;
	var N = nodes.length;
	var R = 42;
	var positions = {};
	var maxCount = 1;
	nodes.forEach(function (n) { if (n.count > maxCount) maxCount = n.count; });

	nodes.forEach(function (node, i) {
		var phi = Math.acos(1 - 2 * (i + 0.5) / N);
		var theta = Math.PI * (1 + Math.sqrt(5)) * i;
		var x = R * Math.sin(phi) * Math.cos(theta);
		var y = R * Math.sin(phi) * Math.sin(theta);
		var z = R * Math.cos(phi);
		positions[node.id] = new THREE.Vector3(x, y, z);
		// 颜色按 id 哈希在绿与蓝绿之间插值
		var t = (Math.sin(node.id * 12.9898) * 43758.5453) % 1;
		t = Math.abs(t);
		node._color = COLOR_A.clone().lerp(COLOR_B, t);
		node._pos = positions[node.id];
	});

	// ---- 节点球体 ----
	var nodeMeshes = [];
	var sphereGeo = new THREE.SphereGeometry(1, 24, 24);
	nodes.forEach(function (node) {
		var size = 1.2 + 3.4 * Math.sqrt(node.count / maxCount);
		var mat = new THREE.MeshStandardMaterial({
			color: node._color,
			roughness: 0.35,
			metalness: 0.1,
			emissive: node._color.clone().multiplyScalar(0.12)
		});
		var mesh = new THREE.Mesh(sphereGeo, mat);
		mesh.position.copy(node._pos);
		mesh.scale.setScalar(size);
		mesh.userData = { node: node, baseSize: size };
		scene.add(mesh);
		nodeMeshes.push(mesh);
	});

	// ---- 边：一次性 LineSegments 批量绘制 ----
	var edgePositions = [];
	var edgeColors = [];
	var maxWeight = 0.0001;
	DATA.edges.forEach(function (e) { if (e.weight > maxWeight) maxWeight = e.weight; });
	DATA.edges.forEach(function (e) {
		var a = positions[e.source], b = positions[e.target];
		if (!a || !b) return;
		edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
		var c = EDGE_BASE.clone().lerp(COLOR_B, e.weight / maxWeight);
		edgeColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
	});
	var edgeGeo = new THREE.BufferGeometry();
	edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
	edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
	var edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 });
	var edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
	scene.add(edgeLines);

	// ---- Raycaster 交互（悬浮 tooltip / 点击跳转）----
	var raycaster = new THREE.Raycaster();
	var mouse = new THREE.Vector2();
	var hovered = null;
	var tooltip = document.getElementById('lsci-tooltip');

	function updateMouse(ev) {
		var rect = renderer.domElement.getBoundingClientRect();
		mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
	}

	function pick() {
		raycaster.setFromCamera(mouse, camera);
		var hits = raycaster.intersectObjects(nodeMeshes, false);
		return hits.length ? hits[0].object : null;
	}

	function onMove(ev) {
		updateMouse(ev);
		var obj = pick();
		if (obj !== hovered) {
			if (hovered) {
				hovered.scale.setScalar(hovered.userData.baseSize);
			}
			hovered = obj;
			if (hovered) {
				hovered.scale.setScalar(hovered.userData.baseSize * 1.35);
				controls.autoRotate = false;
			} else {
				controls.autoRotate = true;
			}
		}
		if (hovered && tooltip) {
			var node = hovered.userData.node;
			var desc = node.description ? node.description : '（该标签暂无描述）';
			tooltip.innerHTML = '<strong>' + node.name + '</strong><span class="lsci-count">' + node.count + ' 篇文章</span><p>' + desc + '</p>';
			tooltip.style.left = (ev.clientX + 14) + 'px';
			tooltip.style.top = (ev.clientY + 14) + 'px';
			tooltip.classList.add('lsci-visible');
			renderer.domElement.style.cursor = 'pointer';
		} else if (tooltip) {
			tooltip.classList.remove('lsci-visible');
			renderer.domElement.style.cursor = 'grab';
		}
	}

	function onClick(ev) {
		updateMouse(ev);
		var obj = pick();
		if (obj && obj.userData.node && obj.userData.node.link) {
			window.location.href = obj.userData.node.link;
		}
	}

	renderer.domElement.addEventListener('mousemove', onMove);
	renderer.domElement.addEventListener('click', onClick);

	// ---- 自适应尺寸 ----
	function onResize() {
		var w = container.clientWidth || window.innerWidth;
		var h = container.clientHeight || Math.round(window.innerHeight * 0.78);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
	}
	window.addEventListener('resize', onResize);

	// ---- 渲染循环 ----
	function animate() {
		requestAnimationFrame(animate);
		controls.update();
		renderer.render(scene, camera);
	}
	animate();
})();
