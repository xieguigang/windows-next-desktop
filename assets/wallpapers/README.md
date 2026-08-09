# 壁纸资源目录

将自定义壁纸文件放在此目录下，然后在「设置 → 个性化 → 壁纸模式」中选择对应模式并填入路径（相对根 URL，例如 `assets/wallpapers/your-image.jpg`）。

## 支持的格式

| 模式 | 格式 | 备注 |
| --- | --- | --- |
| 渐变 | 内置 CSS 渐变 | 无需文件 |
| 图片 | JPG / PNG / WebP / GIF | 推荐 ≥ 1920×1080，浏览器自动 cover |
| 视频 | MP4 / WebM | 提供静音开关，循环播放，页面隐藏时自动暂停省电 |
| HTML | 任意 HTML 文件 | 自动以 sandbox iframe 隔离，禁用对父页面的访问 |

## 内置示例

- `assets/html-wallpapers/particles.html` —— Canvas 粒子连线动态壁纸示例。

## 使用方法

1. 把文件复制到此目录，例如 `my-cat.jpg`。
2. 打开「设置」应用，切换到「图片」模式。
3. 在「图片来源」输入框中填入：`assets/wallpapers/my-cat.jpg`（相对根 URL）。
4. 立即生效。

## 文件大小建议

- 图片：≤ 5 MB（IndexedDB 配额充足，但越大加载越慢）。
- 视频：≤ 20 MB（浏览器解码开销较大）。
- HTML：≤ 100 KB（应为轻量动态背景，非完整页面）。