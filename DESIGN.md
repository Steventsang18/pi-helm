# DESIGN — pi-helm 设计意图

> 目的：把架构决策、契约与权衡写死在仓库里，任何会话（开发或审计）都能凭此接手。
> 事实基线见 README；本文件只讲 **为什么**。冲突时以代码 + README 为准。

## 1. 三层架构分工

```
Layer 1  src/groups.ts     纯状态机
         src/strings.ts    中英文词表（纯数据 + setLang）
         src/styles.ts     显示风格 + DIY 合并（纯数据）
Layer 2  src/renderers.ts  渲染胶水
Layer 3  src/index.ts      接线（事件/降级/面板）
         index.ts          入口 shim（re-export src/index.ts）
```

| 层 | 职责 | 禁止事项 | 测试策略 |
|---|---|---|---|
| L1 `groups.ts` | boundary/carrier/plain 分类、分组注册表、摘要构建、viewPlan、`rebuildFromEntries` | 零 pi import、零主题、零副作用、零模块全局（实例化 registry，避免多会话/reload 竞态） | `node --test` 直测 |
| L1 `strings.ts` | 摘要/行尾用词（call/failed/running/lines/done）+ 工具描述目录 | 零 pi import；只放界面用词，不放业务逻辑 | `setLang` 后直测断言 |
| L1 `styles.ts` | 内置字形/图标/分隔符；settings `style` 覆盖的深合并 | 零 pi import；不放颜色（颜色是 theme token 的事） | merge/覆盖规则直测 |
| L2 `renderers.ts` | 纯行格式化（`fmtSummaryLine`/`fmtRow`/`fmtPinned`）、自壳 `GroupLine`、`registerToolRenderer` 解析器链、per-call 计时器、显示宽度裁剪 | 结构性代码才能被直测——不 import pi 运行时 | 导入本文件直接测 |
| L3 `index.ts` | 事件 → registry、会话恢复重建、冲突降级梯、任务状态、面板、药丸卡、i18n、`/helm` | 不放可单测的业务逻辑 | 手动/集成 |

**为什么这样切**：折叠语义（最容易改错的部分）必须能在没有 pi 环境的单测里跑；渲染与接线各只依赖下面一层，方向单向向下，无环。

**官方红线**（不许违反）：扩展工厂里不启动任何资源；计时器在 `session_start`/渲染时创建、`session_shutdown` 清理；行为层在 JSON/RPC 无头模式照常可用；颜色全走语义主题 token。

## 2. No-Fight 契约 8 条（详见 README 表格）

1. **零原型补丁** — 只用 `registerToolRenderer`/`registerTool`/事件/`ctx.ui`；patch 原型是扩展互殴崩溃的根源。
2. **渲染走解析器链** — `(name, next) => …`，不该自绘就 `return next()`；load order 只决定风格，绝不崩。
3. **工具所有权降级梯** — reasoning 头需要工具定义；`registerTool` 硬失败 → 降级纯渲染模式（行与折叠保留，reasoning 头去掉）+ notify 一次。
4. **命名空间隔离** — 所有 UI key `pi-helm:` 前缀（`setStatus`、药丸 `customType`）；v2 遗留 `mission-pill` 仍要能渲染。
5. **热键可配置** — 默认 `⌃Q`（裸 ctrl 字节，全终端可用）；`/mission` 是永远的逃生门。
6. **working message 礼仪** — 仅 phase 变化才 `setWorkingMessage`；`turn_end` 恢复默认。
7. **生命周期幂等** — 工厂零资源；handler 幂等；可重复 reload。
8. **一键退出** — `/helm off|on|toggle` + `"enabled": false`。

**契约的地位**：这 8 条是与其他扩展共处的硬约束。任何新功能若与某条冲突，先改设计，不许绕过契约。

## 3. 面板 / 分组折叠的权衡

- **折什么**：只折两段 assistant 正文之间的工具调用。`carrier`（纯思考+调工具）并入当前组；`boundary`（带正文）切组且正文永远照常渲染——**折叠只藏工具噪音，不藏正文**，这是与"全屏重排"类方案的根本区别。
- **防闪**：跑不到 1s 的调用不现身（`RUNNING_ROW_DELAY_MS`），否则工具行闪一下就消失比不折还吵。
- **失败粘摘要**：`N failed` 红字贴在摘要行，不吊一排红行；错误永不被静默折叠。
- **edit/write 永不折叠**且切断组：diff 是重点，其后的调用另开新组（宁可多折一行，不让 diff 淹没）。
- **reason-first**：行首放 `reasoning` 短语（引导性可选字段，执行前剥离，不改模型行为）——摘要回答“干了什么”，reason 回答“为什么干”。模型没传时由 `strings.ts` 描述目录兜底（`[运行命令]`），**确定性生成，零 LLM 调用是产品红线**；两者不同时出现（reason 优先）。
- **三级展开**：level 0 摘要行 → level 1 行列表 → level 2 单行完整输出；`Ctrl+O` 整体切换。折叠是纯视图状态，会话恢复时从 `sessionManager.getBranch()` 重建。
- **单调用不折（`autoRow`，A 方案）**：单成员组没有值得摘要的东西，`▸ 1 call · bash×1` 信息量反而低于它藏起来的那行——直接渲染行（无 header、无 `└` gutter，因为它上方没有可连的摘要）；组变回多成员时照旧折摘要。防闪对它不适用：行就是视图本身，不存在“冒出来又缩回去”。`"autoRow": false` 可关。
  - **但显式折叠-all 必须能折到它**（审计 2026-10-28 发现的缺陷）：`Ctrl+O` 折叠-all 对单成员组无效——`solo` 分支无视 level。修法：`Group.soloFolded` 标记“level 0 是用户折的”——新单成员组天生 level 0（`openGroup` 种子），naive 的“solo 尊重 level”会把它们全部默认折起，等于静默杀掉 autoRow。只有 `noteSetExpanded(collapse)` 置位，展开时清除；fresh（未折过）不受影响。
  - **结构不变量**（审计复验确认，这也是 soloFolded 方案成立的根）：`solo=true` → viewPlan 走 solo 分支 → `header` 必为 null → fresh solo 组无头部可点 → **`toggleHeader` 对 fresh solo 组结构上不可达**。因此「单成员 + soloFolded=false + level 1 + 有 header」这个 naive① 触发态不可能存在；toggleHeader 只可能作用于有 header 的单成员组，而那必然已 `soloFolded=true`——不存在第 3 条漏置/漏清路径。
- **默认展开（`defaultExpand`，用户拍板）**：新分组默认 level 0（折叠）是“省地”取向；要“开门见明细”的用户开此开关——新分组直接 level 1（`▾` 头 + 每成员一行）。只影响新建组（`openGroup` 处生效），已建组的 level 不被运行中配置翻转波及；会话恢复重建时也按当前配置展开。与 `autoRow` 正交：单调用组仍优先直出行。
- **摘要行图标化（C 方案）**：`▸ 5 calls · ⚡×3 📖×2`——图标让工具类型一眼可扫；未知工具（MCP 等）保留名字不硬套图标。只改呈现，不加行数。
- **面板（/mission）是 overlay 不是替换**：Esc 秒关、不打断正在跑的回合；药丸卡经 `appendEntry` 注入，不进 LLM 上下文。
- **单一内置风格 + DIY 接口**：不搞多主题预设（维护成本高、伪命题——终端里没有真的“Google 风格”）；内置一套经典字形，`settings.style` 逐项覆盖（`marker`/`openMarker`/`rowGutter`/`sep`/`icons`），空值/未知键不生效（手滑不黒屏）。颜色不开放——theme token 是深浅主题自适应和契约 #1 的前提。
- **显示宽度裁剪**：emoji/CJK 是双宽；按 UTF-16 码元数裁剪（旧代码）会把行裁歪/裁半个 emoji。`stringWidth`/`clipLine` 按显示格宽计（含 VS16 提宽、ZWJ 合字、零宽记号），零 pi 依赖。

## 4. 出处（Provenance）

- 折叠语义吸收自 pi-tidy（MIT, Andy8647/pi-tidy）：boundary/carrier 分类、1s 防闪、失败计数贴摘要、edit/write 不折。
- **我们改了什么**：pi-tidy 的模块全局改为实例化 registry（多会话/reload 竞态）；reason-first 行、执行时钟、药丸卡、面板为自研。
- **为什么更好**：零原型补丁 + 解析器链让 pi-helm 与其它渲染扩展共存（pi-tidy 是独立实现，风格冲突时只能二选一）；分层后折叠语义可直测。
- 计划解析 `Plan:`/`[DONE:n]` 与官方 plan-mode 示例同款方案。

## 5. 未决 / 边界

- 上游对比：repo 尚无 git remote，“最新”只对本地 HEAD 成立。
- 已知冲突矩阵（pi-tidy、工具定义所有者、`alt+…` 热键）见 README。
- **pi 运行时契约（2026-10-28 钤死）**：`renderResult(result, options, theme, context)` 的 `options` 只有 `{expanded, isPartial}`；`durationMs`/`isError` 在 `context` 上（`tool-execution.js` getRenderContext）。读错对象 = 3a 那类“数据尾巴丢失”；改这里前先对照 pi 源码 `dist/core/extensions/types.d.ts` 的 `ToolRenderResultOptions`/`ToolRenderContext`。
- **pi 1.3.0 settings 陷阱（2026-10-28 实锤，曾致全部配置静默失效）**：`pi.getSettings()` 在扩展**工厂期必抛** `Extension runtime not initialized`（`runtime.getSettings` 在 `runner.bindCore()` 才接真实现，晚于所有 factory）。工厂里 try/catch 吞掉 → 所有 settings 静默跑默认值。正确姿势：**工厂期读盘**（`join(getAgentDir(), "settings.json")` 直读全局配置）+ **`session_start` 用官方 API 重读**（此时 runtime 已活，project 覆盖合并进来）。代价：注册期才生效的键（`hotkey`、`enabled`→reasoning 注入）只认全局盘读，project settings 里的这两个不生效——已文档化。教训：**catch 静默吞异常是温床，吞的时候必须留下可见痕迹**。
- pi 对扩展只暴露 `getSettings()`（读），无官方写接口——`/lang` 目前只改会话内存，重启失效；持久化需用户自己在 settings.json 写 `"lang"`（已文档化）。不自作主张写用户 settings 文件。
