# pi-helm ⛵

**你 Pi 会话的指挥台。** 让终端里的 AI 会话一眼看清进度与要点——为长时间开发、多任务并行、以及被终端劝退的所有人设计。

> 终端会话总是很吵：工具调用、代码删减、思考内容、子任务。pi-helm 把工具噪音折成每个回复段一行摘要，行内保留 reason-first 的“为什么”，并把任务状态——计划进度、运行中的任务、要点——放在一个按键之内。

*English version: [README.md](README.md)*

---

## 特性

| | 特性 | 作用 |
|---|---|---|
| ⛵ | **指挥台面板** | `⌃Q`（或 `/mission`）呼出全屏仪表盘：计划进度条 · 运行中任务（耗时实时跳动）· 要点流。Esc 秒关，绝不打断正在跑的回合。 |
| 🗂 | **分组折叠** | 两段 assistant 正文之间的全部工具调用折成一行摘要——`▸ 5 calls · bash×3 read×2 · 1 failed · 1.2s`。点一下展开行列表（`│` 竖线），再点某行看完整输出。跑不到 1s 的调用绝不闪现；失败以 `N failed` 红字粘在摘要上；edit/write 永不折叠（diff 才是重点）。 |
| 📖 | **Reason-first 行** | 每行开头是**为什么干**——模型被引导传入的 `reasoning` 短语：`│ ✗ bash [确认哪个断言挂了] pnpm test · exit 1 · 1.8s`。 |
| ⏱ | **执行实时时钟** | 工具运行时卡片显示 `▶ 运行中 3s`，秒数在待处理底色上实时跳动；结束后落成 `✓ done 2.3s`（绿底）或 `✗ error`（红底）。错误永远不被静默折叠。 |
| 📊 | **计划进度** | 解析 agent 输出中的 `Plan:` 编号步骤和 `[DONE:n]` 标记（与官方 plan-mode 示例同款方案）。进度条同时出现在面板和 footer。 |
| 🔑 | **要点流** | 工具错误和里程碑被确定性捕获，盖成药丸卡嵌入对话流（通过 `appendEntry`，不进 LLM 上下文）。每回合的文件改动自动汇总成 `本轮改动：N 文件 · +a/−b`。 |
| 🎚 | **流式阶段指示器** | assistant 流式输出时，footer 在 `✻ 思考中…` 和 `✍ 撰写回复…` 之间实时切换。 |
| 🌐 | **国际化** | 界面文案中英文随时 `/lang zh|en` 切换；提示词侧保持英文。 |

除 Pi 自带包外零运行时依赖。纯渲染改造：不改 Pi 本体、不发 LLM 调用、不改模型行为（`reasoning` 是引导性可选 schema 字段，执行前会被剥离）。

## 安装

```bash
# 从源码安装（当前）
pi install ./pi-helm

# 或单次试用
pi -e ./pi-helm/index.ts

# 或拷进项目后 /reload
cp index.ts <repo>/.pi/extensions/mission-demo.ts
```

## 使用

| 按键 / 命令 | 作用 |
|---|---|
| `⌃Q` · `⌥G`* · `/mission` | 打开 / 关闭面板（*`⌥G` 需终端开启 Option-as-meta） |
| `/lang zh` · `/lang en` | 切换界面语言 |
| `/milestone <text>` | 记录一个里程碑药丸卡（不发送给 LLM） |
| `/demo-seed` | 注入假任务，立即预览全貌 |
| `/demo-clear` | 清空任务状态 |
| `/helm off` · `/helm on` · `/helm toggle` | 一键退出：关闭 / 重开 pi-helm 渲染 |
| `Ctrl+O` | 原生展开：在摘要行与完整输出之间整体切换 |

当 agent 输出如下内容时，计划进度自动激活：

```
Plan:
1. 第一步
2. 第二步
```

并用 `[DONE:n]` 标记完成的步骤。

## 分组折叠（Group folding）

三级展开，一次点一下：

```
 ▸ 5 calls · bash×3 read×2 · 1 failed · 1.2s          ← level 0：折成一行
 ▾ 5 calls · bash×3 read×2 · 1 failed · 1.2s          ← level 1：点摘要行
 │ ✓ bash [确认哪个断言挂了] pnpm test · exit 1 · 1.8s
 │ ✓ read src/app.ts · 120 lines · 0.0s
 │ ✗ bash [验证修复] pnpm test · exit 1 · 1.2s         ← level 2：点某行
 │   …完整输出 / diff…
```

- **折什么**：两段 assistant 正文之间的全部工具调用。只思考+调工具的步骤不切组（carrier）；带正文的消息切组（boundary）且正文永远照常渲染——折叠只藏工具噪音，不藏任何正文。
- **防闪**：跑不到 1s 的调用不现身；失败数粘在摘要行（`2 failed` 红字），不在折叠组下吊一排红行。
- **永不折叠**：`edit` / `write`——diff 才是重点。它们同时切断组：其后的调用另开新组。
- **`Ctrl+O`** 照旧整体展开 / 收回摘要；点完整框只收起那一个。
- **恢复安全**：会话恢复时从 `sessionManager.getBranch()` 重建分组，reload 后折叠依旧成立。

配置（`~/.pi/agent/settings.json`，`/reload` 生效）：

```json
{
  "pi-helm": {
    "enabled": true,
    "hotkey": "ctrl+q",
    "workingMessage": true,
    "fold": true,
    "neverFold": ["task"]
  }
}
```

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关（同 `/helm off`） |
| `hotkey` | `"ctrl+q"` | 面板热键；`/mission` 永远可用作逃生门 |
| `workingMessage` | `true` | 工作行的流式阶段文案（`✻ 思考中…` / `✍ 撰写回复…`） |
| `fold` | `true` | 分组折叠本身 |
| `neverFold` | `[]` | 保持原生渲染、不折叠的工具名 |

### 防打架契约（No-Fight Contract）

pi-helm 的设计目标就是和其它扩展包共处。以下 8 条是它不打架的保证：

| # | 契约 | 实现 |
|---|---|---|
| 1 | **零原型补丁** | 只用 `registerToolRenderer` / `registerTool` / 事件 / `ctx.ui`；绝不 patch pi 内部组件原型（扩展互殴崩溃的根源） |
| 2 | **渲染走解析器链** | `pi.registerToolRenderer((name, next) => …)`：该自绘时才返回，否则 `return next()`。MCP/第三方工具同样适用，load order 决定风格但绝不崩 |
| 3 | **工具所有权降级梯** | reasoning 头需要拥有工具定义：逐个 `try registerTool(...)`，硬失败（同名已被占）就降级为纯渲染模式——行与折叠保留，reasoning 头去掉，notify 一次 |
| 4 | **命名空间隔离** | UI key 全部 `pi-helm:` 前缀（`setStatus`、药丸 `customType`），不抢别人的槽位 |
| 5 | **热键可配置** | `"pi-helm": { "hotkey": "ctrl+q" }`；已知冲突见下表；`/mission` 永远可用作逃生门 |
| 6 | **working message 礼仪** | 仅 phase 变化时 `setWorkingMessage`；`turn_end` 恢复默认；`workingMessage: false` 可关 |
| 7 | **生命周期幂等** | 工厂零资源；计时器渲染时建、`session_shutdown` 清；handler 幂等 |
| 8 | **一键退出** | `/helm off\|on\|toggle` + `"enabled": false` |

### 已知冲突

| 对手 | 症状 | 对策 |
|---|---|---|
| 另一个折叠/工具卡扩展（如 [pi-tidy](https://github.com/Andy8647/pi-tidy)） | 双方都注册 tool renderer，load order 决定谁的卡片风格生效——不会崩 | 同时只开一个折叠扩展，或把对方工具列进 `neverFold` |
| 拥有 `bash`/`read`/… 工具定义的扩展 | 我们的 `registerTool` 硬失败 | 自动降级：纯渲染模式 + 一次通知（契约 #3） |
| `intercom`（`alt+m`）等 `alt+…` 快捷键 | 热键冲突 | 默认 `⌃Q`（裸 ctrl 字节，所有终端可用）；`⌥G` 别名需 Option-as-meta——pi 自身的 `⌥Enter`/`⌥↑` 也依赖同一设置（iTerm2：Profiles→Keys→Left Option = `Esc+`；Terminal.app：Use Option as Meta key） |

## 架构

```
src/groups.ts      纯状态机        classifyAssistant · GroupRegistry · buildSummary
                                  · viewPlan · rebuildFromEntries（node --test 直测，零 pi 依赖）
src/renderers.ts   渲染胶水        fmtSummaryLine / fmtRow / fmtPinned · GroupLine
                                  · 解析器链 · per-call 计时器
src/index.ts       接线            事件 → registry · 会话恢复重建 · 冲突降级梯
                                  · 任务状态 · 面板 · 药丸卡 · i18n · /helm
index.ts           入口 shim       re-export src/index.ts（包入口）
```

设计遵守官方文档红线：扩展工厂里不启动任何资源；计时器在 `session_start`/渲染时创建、`session_shutdown` 清理；行为层（药丸卡、计数器）在 JSON/RPC 无头模式下照常可用；颜色全部走语义主题 token（自动适配深浅主题）。

## 开发

```bash
pi -e ./index.ts              # 热加载测试
PI_TUI_WRITE_LOG=1 pi -e .    # 调试原始 ANSI 流
```

官方 API 参照文档原文存放在 [`docs/`](docs/)（`extensions.md`、`tui.md`、`packages.md`、`api-types.d.ts`，以及设计指南 `pi-extension-dev-guide.md`）。早期概念演示在 [`examples/`](examples/)。

## 路线图

- [ ] 子任务折叠：嵌套调用折成一行可展开（基于 `parentToolCallId`）
- [x] 会话恢复：分组折叠已从 `sessionManager.getBranch()` 重建（任务状态仍为内存态）
- [ ] L2 下钻：面板内回车跳转到对话流对应位置
- [x] 配置：热键 / 折叠 / working message 开关已进 `settings.json`（图标与语言默认值待做）
- [ ] 可选 AI 摘要层（便宜模型蒸馏回合摘要，默认关闭）

## 致谢

- [pi-tidy](https://github.com/Andy8647/pi-tidy)（MIT）——仅参考分组*语义*：boundary/carrier 分类、1s 防闪延迟、失败粘滞计数、edit/write 永不折叠。本项目代码全部自写——实例化 `GroupRegistry`（不用模块级全局）、带测试的纯状态机、解析器链而非补丁组件。pi-tidy 有测试是它最对的决定，我们保持这个标准。
- [pi-tidy-tools](https://github.com/mikeyobrien/pi-tidy-tools)（MIT）——reason-first 两行块、self-shell 密度、实时时钟模式
- [Pi](https://github.com/earendil-works/pi) 官方文档与示例——`plan-mode`、`minimal-mode`、`custom-footer`、`entry-renderer`

**溯源：** 2026-10-27 研读 `Andy8647/pi-tidy@main`（`tool-groups.ts`、README）的分组语义，未拷贝任何代码——状态机、渲染器、测试均为原创。有意为之的差异：无模块级全局（多会话/reload 安全）、零原型补丁、思考行刻意不进 gutter（YAGNI）、行内 reasoning 头来自我们的 schema 注入。

## 许可证

[MIT](LICENSE)
