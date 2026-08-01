<?php
/**
 * Twenty Twenty-Two functions and definitions
 *
 * @link https://developer.wordpress.org/themes/basics/theme-functions/
 *
 * @package WordPress
 * @subpackage Twenty_Twenty_Two
 * @since Twenty Twenty-Two 1.0
 */

if ( ! function_exists( 'twentytwentytwo_support' ) ) :

	/**
	 * Sets up theme defaults and registers support for various WordPress features.
	 *
	 * @since Twenty Twenty-Two 1.0
	 *
	 * @return void
	 */
	function twentytwentytwo_support() {

		// Add support for block styles.
		add_theme_support( 'wp-block-styles' );

		// Enqueue editor styles.
		add_editor_style( 'style.css' );
	}

endif;

add_action( 'after_setup_theme', 'twentytwentytwo_support' );

if ( ! function_exists( 'twentytwentytwo_styles' ) ) :

	/**
	 * Enqueues styles.
	 *
	 * @since Twenty Twenty-Two 1.0
	 *
	 * @return void
	 */
	function twentytwentytwo_styles() {
		// Register theme stylesheet.
		$theme_version = wp_get_theme()->get( 'Version' );

		$version_string = is_string( $theme_version ) ? $theme_version : false;

		$suffix = SCRIPT_DEBUG ? '' : '.min';
		$src    = 'style' . $suffix . '.css';

		wp_enqueue_style(
			'twentytwentytwo-style',
			get_parent_theme_file_uri( $src ),
			array(),
			$version_string
		);
		wp_style_add_data(
			'twentytwentytwo-style',
			'path',
			get_parent_theme_file_path( $src )
		);
	}

endif;

add_action( 'wp_enqueue_scripts', 'twentytwentytwo_styles' );

// Add block patterns.
require get_template_directory() . '/inc/block-patterns.php';

/**
 * 生命科学科技风格：front-page 三维标签关联网络
 *
 * - 注册本地 three.js + OrbitControls + 自定义可视化脚本（仅首页加载）
 * - 计算所有 post_tag 文章集合的杰卡德系数，过滤低权重边，注入内联 JSON
 */

// 杰卡德系数边阈值（仅显示重叠度高于此值的边）
if ( ! defined( 'LSCI_JACCARD_THRESHOLD' ) ) {
	define( 'LSCI_JACCARD_THRESHOLD', 0.1 );
}

if ( ! function_exists( 'twentytwentytwo_lsci_front_page_scripts' ) ) :

	/**
	 * 仅在首页注册并注入标签关联网络所需脚本与数据。
	 *
	 * @since Twenty Twenty-Two 1.0 (LSCI add-on)
	 *
	 * @return void
	 */
	function twentytwentytwo_lsci_front_page_scripts() {
		if ( ! is_front_page() ) {
			return;
		}

		$theme_version = wp_get_theme()->get( 'Version' );
		$version_string = is_string( $theme_version ) ? $theme_version : false;
		$base_url = get_template_directory_uri() . '/assets/js';

		// 1) 本地 three.js (UMD)
		wp_enqueue_script(
			'lsci-three',
			$base_url . '/vendor/three.min.js',
			array(),
			'0.128.0',
			true
		);

		// 2) 本地 OrbitControls (依赖 three)
		wp_enqueue_script(
			'lsci-orbitcontrols',
			$base_url . '/vendor/OrbitControls.js',
			array( 'lsci-three' ),
			'0.128.0',
			true
		);

		// 3) 自定义可视化脚本（依赖 three + OrbitControls）
		wp_enqueue_script(
			'lsci-tag-network',
			$base_url . '/tag-network.js',
			array( 'lsci-three', 'lsci-orbitcontrols' ),
			$version_string,
			true
		);

		// 4) 计算并注入标签网络数据
		wp_localize_script( 'lsci-tag-network', 'LSCI_TAG_NETWORK', twentytwentytwo_lsci_build_tag_network() );
	}

endif;

add_action( 'wp_enqueue_scripts', 'twentytwentytwo_lsci_front_page_scripts' );

if ( ! function_exists( 'twentytwentytwo_lsci_front_page_styles' ) ) :

	/**
	 * 在首页 <head> 注入三维网络区与 tooltip 的浅色洁净科研风样式。
	 *
	 * @since Twenty Twenty-Two 1.0 (LSCI add-on)
	 *
	 * @return void
	 */
	function twentytwentytwo_lsci_front_page_styles() {
		if ( ! is_front_page() ) {
			return;
		}
		?>
<style id="lsci-tag-network-style">
#lsci-tag-network {
	position: relative;
	width: 100%;
	height: 78vh;
	min-height: 480px;
	overflow: hidden;
	background:
		radial-gradient(1200px 600px at 50% -10%, #eef6f3 0%, rgba(238,246,243,0) 60%),
		linear-gradient(180deg, #ffffff 0%, #f7f9fa 100%);
	touch-action: none;
}
#lsci-tag-network canvas { display: block; }
#lsci-tooltip {
	position: fixed;
	z-index: 9999;
	max-width: 280px;
	padding: 12px 14px;
	border-radius: 10px;
	background: rgba(255, 255, 255, 0.92);
	border: 1px solid rgba(46, 158, 91, 0.25);
	box-shadow: 0 12px 32px rgba(27, 158, 158, 0.18);
	backdrop-filter: blur(6px);
	color: #2b3a42;
	font-family: PingFang SC, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
	font-size: 13px;
	line-height: 1.55;
	opacity: 0;
	transform: translateY(4px);
	transition: opacity .15s ease, transform .15s ease;
	pointer-events: none;
}
#lsci-tooltip.lsci-visible { opacity: 1; transform: translateY(0); }
#lsci-tooltip strong {
	display: block;
	font-size: 15px;
	font-weight: 600;
	color: #1b9e9e;
	margin-bottom: 2px;
}
#lsci-tooltip .lsci-count {
	display: inline-block;
	font-size: 11px;
	color: #5b6b73;
	margin-bottom: 6px;
}
#lsci-tooltip p { margin: 0; color: #5b6b73; }
.lsci-network-section { border-top: 1px solid rgba(46,158,91,0.12); }
</style>
		<?php
	}

endif;

add_action( 'wp_head', 'twentytwentytwo_lsci_front_page_styles' );

if ( ! function_exists( 'twentytwentytwo_lsci_build_tag_network' ) ) :

	/**
	 * 构建 post_tag 关联网络数据。
	 *
	 * 读取所有 post_tag，取得每个标签关联的文章 ID 集合，
	 * 计算两两标签的杰卡德系数 J = |A∩B| / |A∪B|，仅保留 ≥ 阈值的边。
	 *
	 * @since Twenty Twenty-Two 1.0 (LSCI add-on)
	 *
	 * @return array { nodes: [...], edges: [...] }
	 */
	function twentytwentytwo_lsci_build_tag_network() {
		// 读取所有 post_tag（含空标签，便于展示全貌）
		$tags = get_terms(
			array(
				'taxonomy'   => 'post_tag',
				'hide_empty' => false,
				'number'     => 0,
			)
		);

		if ( is_wp_error( $tags ) || empty( $tags ) ) {
			return array( 'nodes' => array(), 'edges' => array() );
		}

		// 每个标签的文章 ID 集合
		$tag_posts = array();
		foreach ( $tags as $tag ) {
			$ids = get_posts(
				array(
					'fields'         => 'ids',
					'post_type'      => 'post',
					'post_status'    => 'publish',
					'posts_per_page' => -1,
					'tax_query'      => array(
						array(
							'taxonomy' => 'post_tag',
							'field'    => 'term_id',
							'terms'    => $tag->term_id,
						),
					),
				)
			);
			$tag_posts[ $tag->term_id ] = array(
				'id'          => (int) $tag->term_id,
				'name'        => $tag->name,
				'slug'        => $tag->slug,
				'description' => $tag->description,
				'count'       => (int) $tag->count,
				'link'        => get_tag_link( $tag->term_id ),
				'set'         => array_flip( $ids ),
			);
		}

		// 节点（去除内部 set 字段）
		$nodes = array();
		foreach ( $tag_posts as $tp ) {
			$nodes[] = array(
				'id'          => $tp['id'],
				'name'        => $tp['name'],
				'slug'        => $tp['slug'],
				'description' => $tp['description'],
				'count'       => $tp['count'],
				'link'        => $tp['link'],
			);
		}

		// 两两计算杰卡德系数
		$edges = array();
		$ids = array_keys( $tag_posts );
		$threshold = LSCI_JACCARD_THRESHOLD;

		for ( $i = 0; $i < count( $ids ); $i++ ) {
			for ( $j = $i + 1; $j < count( $ids ); $j++ ) {
				$a = $tag_posts[ $ids[ $i ] ]['set'];
				$b = $tag_posts[ $ids[ $j ] ]['set'];

				$union = count( $a ) + count( $b ) - count( array_intersect_key( $a, $b ) );
				if ( $union <= 0 ) {
					continue;
				}
				$inter = count( array_intersect_key( $a, $b ) );
				$jaccard = $inter / $union;

				if ( $jaccard >= $threshold ) {
					$edges[] = array(
						'source' => (int) $ids[ $i ],
						'target' => (int) $ids[ $j ],
						'weight' => round( $jaccard, 4 ),
					);
				}
			}
		}

		return array(
			'nodes' => $nodes,
			'edges' => $edges,
		);
	}

endif;
