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

	// ---- 配色（暗色科技风：高亮绿 / 蓝绿用于连线，节点为白色平面圆）----
	var COLOR_A = new THREE.Color('#4ec9b0'); // 高亮薄荷绿
	var COLOR_B = new THREE.Color('#4ea1ff'); // 冷调亮蓝
	var EDGE_BASE = new THREE.Color('#cececeff');
	var NODE_WHITE = new THREE.Color('#ffffff');

	// ---- 场景 / 相机 / 渲染器 ----
	var scene = new THREE.Scene();
	scene.background = new THREE.Color('#0f1115');
	scene.fog = new THREE.Fog('#0f1115', 90, 240);

	var width = window.innerWidth;
	var height = window.innerHeight;

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

	// ---- 节点：白色平面圆形（post_tag 节点）----
	var nodeMeshes = [];
	var circleGeo = new THREE.CircleGeometry(1, 48);
	nodes.forEach(function (node) {
		var size = 1.2 + 3.4 * Math.sqrt(node.count / maxCount);
		// 白色平面圆片，不受光照影响，双面可见
		var mat = new THREE.MeshBasicMaterial({
			color: NODE_WHITE,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.95
		});
		var mesh = new THREE.Mesh(circleGeo, mat);
		mesh.position.copy(node._pos);
		// 初始朝向相机方向（z 轴），由 animate 中的 billboard 持续调整
		mesh.lookAt(camera.position);
		mesh.scale.setScalar(size);
		mesh.userData = { node: node, baseSize: size, billboard: true };
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
		var w = window.innerWidth;
		var h = window.innerHeight;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
	}
	window.addEventListener('resize', onResize);

	// ---- 渲染循环 ----
	function animate() {
		requestAnimationFrame(animate);
		controls.update();
		// post_tag 白色圆片始终面向相机（billboard）
		for (var i = 0; i < nodeMeshes.length; i++) {
			var m = nodeMeshes[i];
			if (m.userData && m.userData.billboard) {
				m.lookAt(camera.position);
			}
		}
		renderer.render(scene, camera);
	}
	animate();
})();
