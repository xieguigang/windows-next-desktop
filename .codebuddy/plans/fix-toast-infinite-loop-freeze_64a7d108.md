---
name: fix-toast-infinite-loop-freeze
overview: 修复 notification.js 第59-61行 while 循环因重复对已标记 is-leaving 的元素调用 _dismiss 导致无限循环、页面卡死的 bug
todos:
  - id: fix-infinite-loop
    content: 修改 src/core/notification.js 第59-61行的 while 循环，改为基于活跃（非 is-leaving）元素计数并加入安全迭代上限
    status: completed
---

## 用户需求

修复桌面右下角 toast 通知系统的 bug：当用户连续快速触发 4 个或以上错误消息 toast 时，整个页面会卡死。

## 问题定位

Bug 根因位于 `src/core/notification.js` 第 59-61 行的 while 循环：

- `MAX_TOASTS = 4`，当第 5 个 toast 创建时进入 `while (this.stack.children.length >= MAX_TOASTS)` 循环
- 循环调用 `_dismiss(firstElementChild)`，但 `_dismiss` 仅添加 `is-leaving` CSS class 并播放 180ms 退出动画，**不会立即从 DOM 中移除元素**
- 循环第二次迭代时 `firstElementChild` 仍是同一个元素，`_dismiss` 的防重入检查 `el.classList.contains('is-leaving')` 直接 return，不执行任何操作
- `children.length` 永不减少，形成死循环，导致页面冻结

## 核心修复

修改 while 循环逻辑：仅对未标记 `is-leaving` 的活跃子元素进行计数和清理，并加入安全迭代次数上限，彻底消除无限循环风险。

## 技术栈

- 语言：JavaScript (Vanilla)
- 涉及文件：`src/core/notification.js`

## 实现方案

### 修复策略

将原来基于 `children.length` 的 while 循环改为基于**活跃（非 is-leaving）子元素数量**的判断逻辑：

1. 计算当前活跃 toast 数量 = `stack.children` 中不含 `is-leaving` 类的元素数量
2. 若活跃数量 >= `MAX_TOASTS`，找到第一个不含 `is-leaving` 的子元素并调用 `_dismiss`
3. 加入 `MAX_TOASTS + 1` 次迭代上限作为兜底安全保护，防止任何边界情况导致死循环

### 修改位置

**文件**：`src/core/notification.js`
**行号**：第 59-61 行（`toast` 方法中的溢出清理循环）

**当前代码**：

```javascript
while (this.stack.children.length >= MAX_TOASTS) {
    this._dismiss(this.stack.firstElementChild);
}
```

**修复后代码**：

```javascript
const maxIter = MAX_TOASTS + 1;
let iter = 0;
while (this.stack.children.length >= MAX_TOASTS && iter < maxIter) {
    iter++;
    const first = this.stack.firstElementChild;
    if (first && !first.classList.contains('is-leaving')) {
        this._dismiss(first);
    } else {
        break; // 第一个元素已经是 is-leaving 状态，等待动画结束
    }
}
```

### 修复逻辑说明

- `iter < maxIter`：硬性上限防止死循环（仅需在极边缘情况下生效）
- `!first.classList.contains('is-leaving')`：只对未在退出动画中的元素调用 `_dismiss`
- `break`：当第一个元素已处于 leaving 状态时跳出，避免忙等待；新 toast 仍然会追加到 DOM（因为动画结束后旧元素会被移除）