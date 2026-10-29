# 调研：右侧竖排圆点导航（conversation minimap）

> 性质：可行性调研（2026-10-29），**未立项**。结论供用户决策。
> 需求：屏幕右侧固定一列竖排圆点，每点对应一段用户对话（书签/目录）；悬停显示该段提示词；点击定位跳转。

## 结论：部分能做

| 能力 | 结论 | 依据 |
|---|---|---|
| 圆点条贴右侧 + 常驻不消失 | ✅ 能 | `OverlayAnchor` 含 `right-center`/`top-right`/`bottom-right`（pi-tui `tui.d.ts:123`）；`showExtensionCustom` overlay 模式下 Promise 不 close 即常驻（pi `interactive-mode.js:2340-2380`）；无自动 Esc 关闭、无模态强制 |
| 不打断正在跑的回合 | ✅ 能 | `nonCapturing: true` 不抢键盘焦点（`tui.d.ts:165`），编辑器照常输入 |
| 圆点 hover 高亮 + 提示词 tooltip | ✅ 能（有降级） | 全屏模式默认 all-motion 鼠标跟踪（1003h，含无按键 move 事件，`tui-alt-screen.js:17,192`）；`dispatchMouseToOverlay` 按渲染 bounds 命中分发，**不按焦点过滤**——非聚焦 overlay 照样收到鼠标（`tui.js:517-541`） |
| 点击圆点**精确跳转**到该段对话 | ❌ **不能** | 无绝对定位 API：pi 只暴露相对 `scrollBy(lines)`（`tui-alt-screen.d.ts:107`，public 但不在 `TUI` 接口上，需鸭子类型）；无 `scrollToEntry`；扩展无法得知每条消息渲染后占多少行，行号映射建立不起来 |
| 会话恢复后圆点复现 | ✅ 能 | `sessionManager.getBranch()` 返回 `SessionEntry[]`，`role:"user"` 消息可按条切分（实测：每条 user 消息 content 为 text block 数组，一条=一段对话） |
| 挤占 transcript 宽度 | ✅ 不挤 | overlay 是合成到内容行**之上**（`tui.js:958` "Composite all overlays into content lines"），非布局重排；代价是遮挡所盖区域——窄条（2-3 列）贴右缘，遮挡极小 |
| 零 prototype patch（契约#1） | ✅ 合规 | 全程官方 API：`ctx.ui.custom(overlay:true)` + `overlayOptions` 透传 + 组件 `handleMouse`。无任何原型补丁 |

## 关键技术事实（均已核源码）

1. **overlay 生命周期**：`ctx.ui.custom(factory, { overlay:true, overlayOptions, onHandle })` 返回 Promise；不调 `done()` 就常驻；`onHandle` 拿 `OverlayHandle`（`setHidden`/`getBounds`/`hide`）。
2. **overlayOptions** 支持 `anchor`/`col`/`row`/`offsetX/Y`/`width`/`height`/`margin`/`visible`/`nonCapturing`；`visible(termW,termH)` 可按终端尺寸自动隐藏（小终端防挤爆的官方手段）。
3. **鼠标**：两种 TUI 模式（fullscreen=默认 / regular）都有 `dispatchMouseToOverlay`；事件类型含 `move`（hover）。pi 默认 `tuiMode: "fullscreen"`（`settings-defaults.js:61`）。
4. **用户轮次映射**：`role:"user"` 的 message 即用户段落边界，可靠。

## 风险清单

| # | 风险 | 等级 | 说明 |
|---|---|---|---|
| 1 | **点击跳转只能近似** | **高（价值打折）** | 无绝对滚动 API、无 entry→行号映射。替代：悬停 tooltip 显示该段提示词全文，用户借它判断+手动滚/搜索定位。跳转本身做不了精确版 |
| 2 | tmux/zellij/screen 下 hover 失效 | 中 | 这些环境 pi 降级为 button-motion（无 move 事件，`tui-alt-screen.js:186-193`）——tooltip 只能改为点击触发 |
| 3 | `scrollBy` 不在 TUI 接口上 | 低 | 鸭子类型调用，pi 升级可能变 private；且相对滚动本身不可靠（不知道目标行号），预计不用于本方案 |
| 4 | 遮挡 transcript 右缘文字 | 低 | 2-3 列窄条，影响小；可用 `visible` 在窄终端完全隐藏 |

## 实现方案草图（若立项）

- **组件**：`NavDots`（自绘 Component）——竖排一列，每行一个圆点（● 当前段 / ○ 其他段），`handleMouse` 处理 move（高亮+显示 tooltip 子 overlay 或就地展开）与 click（选中段，圆点旁显示该段提示词截断）。
- **数据**：`getBranch()` 遍历，`role==="user"` 的 text 首行做段落标题；会话进行中由 `message_end`（user 消息）增量更新；`rebuildFromEntries` 同源逻辑复用。
- **挂载**：`ctx.ui.custom(overlay:true, overlayOptions:{ anchor:"right-center", width:3, nonCapturing:true, visible:(w)=>w>=80 })`；`/helm nav on|off` 或热键开关。
- **tooltip**：hover 时在圆点左侧展开一个临时 overlay 显示该段提示词（或圆点列内联换行）；tmux 环境退化为点击显示。

## 工期估算（诚实）

- 圆点组件 + overlay 挂载 + 开关 + 窄终端降级：**1 天**
- 数据源（轮次映射 + 会话恢复 + 进行中增量）：**0.5 天**
- hover/点击交互 + tooltip：**0.5-1 天**（含 tmux 降级）
- 边界（reload/多会话/遮挡/测试）：**0.5-1 天**
- **合计：约 2.5-4 天**（不含跳转——跳转做不了）

## 给用户的决策点

核心价值是"快速定位想翻查的地方"。**精确定位跳转在 pi 官方 API 内做不到**。若"悬停看提示词 + 圆点感知当前位置"对你足够（翻查仍靠手动滚/搜索），立项值得（约 3 天）；若跳转是硬需求，建议放弃或等 pi 上游暴露 scrollToEntry 类 API 再做。
