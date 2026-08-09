/**
 * ECharts 按需加载器
 *
 * 只在首次需要（计算器绘图、任务管理器性能曲线）时才注入 <script>，
 * 加载完成后挂到全局 window.echarts。失败返回 null，由应用渲染降级提示。
 *
 * CDN 优先；可被设置 `system.echartsCdn` 覆盖。
 */

let loadingPromise = null;

export function ensureEcharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve) => {
    const src = (window.WinNext?.settings?.get?.('system.echartsCdn') || 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js');
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve(window.echarts || null);
    s.onerror = () => {
      console.error('[ECharts] 加载失败：', src);
      loadingPromise = null;
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return loadingPromise;
}