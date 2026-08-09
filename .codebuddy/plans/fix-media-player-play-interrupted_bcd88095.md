---
name: fix-media-player-play-interrupted
overview: 修复媒体播放器 "the play() request was interrupted by a call to pause()" 导致无法播放的问题：为播放请求引入代际令牌与 pending play promise 管理，规范 src 切换与 pause/stop 时序，并修正音频图建立时机。
todos:
  - id: add-play-guards
    content: 在 index.js 新增 playToken 令牌、pendingPlays 表与 safePlay/safePause/isAbortError 工具函数
    status: completed
  - id: fix-play-index
    content: 改造 playIndex：切源前安全暂停、await 后校验令牌、音频图调用前移
    status: completed
    dependencies:
      - add-play-guards
  - id: fix-pause-paths
    content: 将 setPlayerFor、stop、toggle、ended、移除/清空、onDispose 全部改用 safePause
    status: completed
    dependencies:
      - add-play-guards
  - id: error-classify
    content: 按 AbortError/NotAllowedError/其他三级分流错误提示，消除误报 toast
    status: completed
    dependencies:
      - fix-play-index
      - fix-pause-paths
  - id: file-association
    content: 补充 ctx.args.filePath 文件关联启动，自动入列并播放
    status: completed
    dependencies:
      - fix-play-index
  - id: verify-playback
    content: 使用 [skill:playwright-cli] 启动服务并验证音视频播放与连续切歌无报错
    status: completed
    dependencies:
      - error-classify
      - file-association
---

## 用户需求

修复 `src/apps/media-player` 多媒体播放器无法播放的问题。当前点击播放列表曲目或播放按钮时，控制台抛出 `The play() request was interrupted by a call to pause()`，媒体无法正常播放。需要审查播放器代码，定位竞态根因并彻底修复。

## 产品概述

媒体播放器保持现有 Windows Groove 风格双栏布局（左侧封面/元信息/进度/控件，右侧频谱+播放列表）不变，仅修复播放链路的稳定性问题，让音频与视频都能稳定播放、切换、连播。

## 核心功能

- **播放请求稳定化**：点击列表任意曲目、快速连点、连续切歌、音视频交替切换时均能正常播放，不再出现播放被中断的报错。
- **正确的错误提示**：仅在真实播放失败（文件损坏、解码失败、自动播放被拦截）时提示用户；因新播放请求取代旧请求而产生的中断属于正常流程，静默处理，不再弹出误导性的「播放失败」通知。
- **声音与频谱恢复**：确保播放时有声音，频谱可视化随当前播放元素（音频或视频）正确联动。
- **播放态一致性**：播放/暂停按钮图标、封面旋转动画、进度条、时长显示始终与实际播放元素状态一致。
- **文件关联打开**：从资源管理器双击媒体文件启动播放器时，自动把该文件加入列表并播放。
- **清空、移除、关闭窗口**等操作不会残留正在播放的声音，也不会产生未捕获的异步报错。

## 技术栈

沿用项目现有形态，不引入任何新依赖：

- 原生 ES Module + 浏览器原生 `HTMLMediaElement` / Web Audio API
- 应用 SDK：`ctx.fs.createObjectURL`、`ctx.settings.getLocal/setLocal`、`ctx.notify.*`、`ctx.onDispose`、`ctx.observeResize`
- 唯一改动文件：`src/apps/media-player/index.js`（样式与清单无需变更）

## 根因分析（已在代码中确认）

`The play() request was interrupted by a call to pause()` 是浏览器抛出的 `AbortError`：对同一个媒体元素，上一次 `play()` 返回的 Promise 尚未 settle，就发生了 `pause()`、重新赋值 `src` 或 `load()`，浏览器即中止该次播放请求并 reject。

当前 `index.js` 中存在以下竞态点：

1. **`playIndex` 可重入且无串行化**（第 260-289 行）。`resolveUrl` 为 async（`ctx.fs.createObjectURL` 需读 blob），在 `await` 期间用户再次点击列表项会开启第二条 `playIndex`，后者的 `setPlayerFor` 与 `player.src = src` 直接打断前一条仍 pending 的 `play()`。
2. **`setPlayerFor` 无条件 `other.pause()`**（第 245 行）。音视频交替切换时，若另一元素上仍有 pending 的 play 请求，会被立即中止并 reject。
3. **重设 `src` 前未先暂停**（第 274 行）。对正在加载/播放的元素直接覆盖 `src`，规范上等同 abort 当前播放请求。
4. **`stop()` 的 `pause()` + `removeAttribute('src')` + `load()`**（第 291-296 行），以及清空列表 / 移除当前曲目路径，都可能落在 pending play 的窗口内。
5. **`ensureAudioGraph` 调用时机偏晚**（第 281 行，在 `await player.play()` 之后）。`resolveUrl` 的 await 已经断开用户手势调用栈，`AudioContext` 可能停留在 `suspended`；一旦 `createMediaElementSource` 把元素输出重定向到未 resume 的上下文，就会出现「进度在走但没声音」，与中断报错叠加表现为「无法播放」。
6. **`catch` 未区分错误类型**（第 285、313 行），把正常的 `AbortError` 当作失败弹 toast，掩盖真实问题。

## 实现方案

核心策略：**用「播放代际令牌 + pending play 追踪」把所有播放请求串行化**，并把所有 `pause()` 收敛到统一的安全封装中。

### 1. 播放请求令牌（generation token）

新增模块级 `let playToken = 0;`。`playIndex` 入口 `const token = ++playToken;`，每个 `await` 之后（`resolveUrl` 之后、`safePlay` 之后）校验 `if (token !== playToken) return;`。这样后发起的请求天然作废先前的请求，避免「旧请求的 DOM 赋值覆盖新请求」的错乱。复杂度 O(1)，无额外内存开销。

### 2. `safePlay(el)` / `safePause(el)` 统一封装

用 `Map<HTMLMediaElement, Promise>` 记录每个元素当前 pending 的 play promise：

- `safePlay(el)`：调用 `el.play()`，把 promise 存入 map，settle 后清除；对 reject 统一归一化返回结果，不向外抛。
- `safePause(el)`：先 `await` 该元素的 pending play promise（用 `.catch(() => {})` 吞掉），再调用 `el.pause()`。这是消除该报错的关键——**永远不在 play 未 settle 时 pause**。
- 该封装同时被 `setPlayerFor`、`stop`、`toggle`、移除曲目、`onDispose` 复用，符合 DRY。

### 3. 切源前先安全暂停

`playIndex` 中赋值 `src` 之前先 `await safePause(player)`，再 `player.src = src`。避免直接覆盖 src 触发 abort。

### 4. 错误分级

新增 `isAbortError(err)` 判定（`err?.name === 'AbortError'` 或 message 含 `interrupted`）：

- `AbortError` → 静默（属请求被取代的正常现象）
- `NotAllowedError` → 提示「浏览器已阻止自动播放，请点击播放按钮」
- 其他 → 沿用 `ctx.notify.warning('播放失败：…')`

这一分级同时消除误报 toast，让真实错误可见。

### 5. 音频图时机前移

把 `ensureAudioGraph(player)` 提前到 `safePlay` 之前调用（列表点击、播放按钮点击都在用户手势链上，`resolveUrl` 的 await 之后再调用仍可通过已存在的 `audioCtx.resume()` 兜底）。同时在 `playBtn` / 播放列表行的 **同步** 点击处理入口先调用一次 `resumeAudioCtx()`，确保 `AudioContext` 在真实手势栈内 resume，解决无声问题。

### 6. `repeat-one` 与 `ended` 走同一通道

`ended` 中的 `el.play()` 改为 `safePlay(el)`，保持错误处理一致。

### 7. 附带修复：文件关联启动

经确认 `manifests.js` 为 `media-player` 注册了 11 种媒体扩展名，但 `index.js` 全文未读取 `ctx.args.filePath`，双击媒体文件打开后列表为空。在 mount 末尾补充：若 `ctx.args?.filePath` 存在则 `await addPaths([ctx.args.filePath])` 并播放该曲目（参照 `src/apps/image-viewer/index.js` 第 396-398 行的既有写法）。

## 实现要点（防回归）

- **不改动 DOM 结构与 CSS**：双舞台 `.mp-stage-audio` / `.mp-stage-video` 常驻、靠 `.mp-cover.is-video` 切换显隐的设计保留；事件处理器中 `if (el !== player) return;` 的过滤约定保留。
- **`sourceNodes` 缓存语义不变**：每个媒体元素只能创建一次 `MediaElementAudioSourceNode`，继续按元素缓存并在切换时先 disconnect 全部再 connect 当前，避免两路混入 analyser。
- **`saveState` 持久化字段不变**：仍只存 `path/name/kind/duration`，不落 blob URL（刷新即失效）。
- **`resolveUrl` 的 URL 缓存保留**：`ctx.fs.createObjectURL` 由 SDK 在窗口关闭时统一 revoke（`app-context.js` 第 175-179 行 `revokables`），不在应用内重复 revoke，避免提前失效。
- **性能**：新增结构仅为一个自增整数与一个至多 2 项的 Map，`drawVisualizer` 的 rAF 循环与 `analyser` 配置保持原样，无额外开销；避免在 rAF 内做任何新增判断。
- **`onDispose` 收口**：改用 `safePause` 并取消 rAF、断开 source、关闭 audioCtx，避免窗口关闭时抛未捕获的 AbortError。
- **不做无关重构**：保持文件内既有的函数划分与中文注释风格，仅在改动处补充说明竞态原因的注释。

## 关键代码结构

```js
/** 播放代际令牌：每次新的播放请求自增，旧请求 await 恢复后自行作废 */
let playToken = 0;
/** 每个媒体元素当前 pending 的 play() promise，pause 前必须先等它 settle */
const pendingPlays = new Map(); // Map<HTMLMediaElement, Promise<void>>

/** 安全播放：登记 pending promise，吞掉 AbortError，返回是否成功 */
function safePlay(el) /* : Promise<{ok:boolean, err?:Error}> */
/** 安全暂停：先等待该元素 pending 的 play 完成，再 pause */
function safePause(el) /* : Promise<void> */
/** 判定是否为「播放请求被取代」的正常中断 */
function isAbortError(err) /* : boolean */
```

## 目录结构

```
g:/WindowsNext/
└── src/
    └── apps/
        └── media-player/
            └── index.js   # [MODIFY] 唯一改动文件。新增 playToken 代际令牌与 pendingPlays 追踪表；
                           #   新增 safePlay / safePause / isAbortError 三个工具函数；
                           #   改造 playIndex（切源前 safePause、await 后校验 token、音频图前移）；
                           #   改造 setPlayerFor（other.pause → safePause）、stop、toggle、
                           #   ended 的 repeat-one 分支、移除曲目与清空列表路径、onDispose 收口；
                           #   错误提示按 AbortError / NotAllowedError / 其他 三级分流；
                           #   末尾补充 ctx.args.filePath 文件关联启动处理。
```

## Agent Extensions

### Skill

- **playwright-cli**
- Purpose: 通过 `serve.js` 启动本地服务后，用浏览器自动化打开桌面应用、进入媒体播放器，导入并播放 `assets/` 下的 mp4 媒体文件，捕获控制台错误以验证 `The play() request was interrupted by a call to pause()` 是否消失。
- Expected outcome: 控制台不再出现该 AbortError，媒体元素进入 playing 状态，快速连点切歌场景下也无未捕获异常。