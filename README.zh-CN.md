# pi-helm ⛵

![Version](https://img.shields.io/github/v/tag/Steventsang18/pi-helm?label=version&color=blue)
![License](https://img.shields.io/github/license/Steventsang18/pi-helm?color=green)
![pi](https://img.shields.io/badge/pi-1.3.0-orange)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![CI](https://github.com/Steventsang18/pi-helm/actions/workflows/test.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-any%20pi%20terminal-lightgrey)
![PRs](https://img.shields.io/badge/PRs-welcome-ff69b4)

**你 Pi 会话的指挥台。** 让长时间终端会话保持可读：工具噪音折成每段回复一行摘要，每行先说“为什么干”，任务状态（计划进度、运行中任务、要点）一个按键就到手。

> 终端会话总是很吵：工具调用、代码差异、思考内容、子任务。pi-helm 把工具噪音折成每段回复一行摘要，行内保留 reason-first 的“为什么”，并把任务状态收在一个按键之内。

*English version: [README.md](README.md)*

---

## 特性

| | 特性 | 作用 |
|---|---|---|
| ⛵ | **指挥台面板** | `⌃Q`（或 `/mission`）呼出仪表盘：计划进度条 · 运行中任务（耗时实时跳动）· 要点流。Esc 秒关，绝不打断正在跑的回合。 |
| 🗂 | **分组折叠** | 两段 assistant 正文之间的全部工具调用折成一行摘要——`▸ 5 次调用 · 🔨×3 👀×2 · ✗ 1 次失败 · 1.2s`。点摘要展开行列表（`│` 竖线），点某行看完整输出。跑不到 1s 的调用绝不闪现；失败以 `✗ N 次失败` 粘在摘要上；`edit`/`write` 永不折叠（diff 才是重点）。 |
| 💬 | **Reason-first 行** | 每行开头是**为什么干**——模型被引导传入的 `reasoning` 短语：`│ ✗ bash [确认哪个断言挂了] pnpm test · exit 1 · 1.8s`。模型没传时，内置中英双语工具描述目录兜底。 |
| ⏱ | **执行实时时钟** | 工具运行时卡片显示盲文 spinner 加实时跳动的耗时；结束后落成 `✓ 完成 2.3s`（绿）或 `✗ 出错`（红）。错误永不被静默折叠。 |
| 📊 | **计划进度** | 解析 agent 输出里的 `Plan:` 编号步骤与 `[DONE:n]` 标记（与官方 plan-mode 示例同款方案）。进度条同时出现在面板和状态行。 |
| 🔑 | **要点流** | 工具错误和里程碑被确定性捕获，盖成药丸卡嵌入对话流（经 `appendEntry`，不进 LLM 上下文）。每回合的文件改动自动汇总成 `本轮改动：N 文件 · +a/−b`。 |
| 🎚 | **流式阶段指示器** | assistant 流式输出时，状态行在 `🧠 思考中…` 与 `✍ 撰写回复…` 之间实时切换。 |
| 🌐 | **国际化** | 界面文案中文/英文随时用 `/lang zh\|en` 切换。提示词侧保持英文。 |
| 🛰 | **常驻 HUD** | 编辑器下方可选 3 行面板：计划进度、运行中任务（带转动的 spinner）、错误/要点计数。默认关闭（`hudEnabled`）。点 `⌃Q` 提示可打开指挥台面板。 |

除 Pi 自带包外零运行时依赖。纯渲染改造：不改 Pi 本体、不发 LLM 调用、不改模型行为（`reasoning` 是引导性可选 schema 字段，执行前会被剥离）。

## 安装

已在 pi 1.3.0 测试通过。

```bash
pi install /path/to/pi-helm
```

该命令把本包注册进 `~/.pi/agent/settings.json`。装完**必须重启 pi**——`/reload` 换不掉已加载的 ESM 模块。

### 怎么确认装好了

1. 重启 pi。
2. 让它做点会调用工具的事（例如“跑一下测试”）。
3. 应该看到工具调用被折成一行摘要，开头是 `▸`，例如 `▸ 2 次调用 · 🔨×1 👀×1 · 1.1s`。

如果看到的是 pi 原生的工具框，说明扩展没加载——试试 `/mission`（能弹出面板即意味着已加载），并查看 pi 启动时有无扩展报错。

### 备选方式

```bash
pi -e /path/to/pi-helm/index.ts                      # 单次试用，不安装
cp -r src index.ts ~/.pi/agent/extensions/pi-helm/   # 手动复制，然后重启 pi
```

## 使用

| 按键 / 命令 | 作用 |
|---|---|
| `⌃Q` · `⌥G`* · `/mission` | 打开 / 关闭面板（*`⌥G` 需要终端开启 Option-as-meta） |
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

## 分组折叠

三级展开，一次点一下：

```
 ▸ 5 次调用 · 🔨×3 👀×2 · ✗ 1 次失败 · 1.2s           ← level 0：折成一行
 ▾ 5 次调用 · 🔨×3 👀×2 · ✗ 1 次失败 · 1.2s           ← level 1：点摘要行
 │ ✓ bash [确认哪个断言挂了] pnpm test · exit 1 · 1.8s
 │ ✓ read src/app.ts · 120 行 · 0.0s
 │ ✗ bash [验证修复] pnpm test · exit 1 · 1.2s        ← level 2：点某行
 │   …完整输出 / diff…

 └ ✓ bash [运行命令] pnpm test · exit 1 · 1.8s        ← 只有 1 个调用：不折，直接出行
```

- **单调用不折（`autoRow`）**：组里只有 1 个调用时没有值得摘要的东西——`▸ 1 次调用 · bash×1` 反而藏了“干了啥”，直接显示那行；多调用照旧折摘要。
- **折什么**：两段 assistant 正文之间的全部工具调用。只思考+调工具的步骤不切组（carrier）；带正文的消息切组（boundary）且正文永远照常渲染——折叠只藏工具噪音，不藏任何正文。
- **防闪**：折叠组里跑不到 1s 的调用不现身（单调用组的行从第一帧就是实时的，它就是视图本身）；失败数粘在摘要行，不在折叠组下吊一排红行。
- **永不折叠**：`edit` / `write`——diff 才是重点，行尾带 `+12/−3` 差异统计与 `↑↓` 用量，正文在固定视口内滚动。它们同时切断组：其后的调用另开新组。
- **`Ctrl+O`** 照旧整体展开 / 收回摘要；点完整框只收起那一个。
- **恢复安全**：会话恢复时从保存的分支重建分组，重启后折叠依旧成立。

## 配置

`~/.pi/agent/settings.json`，改完**必须重启 pi**（`/reload` 换不掉已加载的 ESM）：

```json
{
  "pi-helm": {
    "enabled": true,
    "hotkey": "ctrl+q",
    "workingMessage": true,
    "fold": true,
    "neverFold": ["task"],
    "autoRow": true,
    "defaultExpand": false,
    "pinnedBodyHeight": 14,
    "hudEnabled": true,
    "lang": "zh",
    "style": { "marker": "▸", "icons": { "bash": "🔨" }, "spinner": ["⠋", "⠙", "⠹"] }
  }
}
```

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关（同 `/helm off`） |
| `hotkey` | `"ctrl+q"` | 面板热键；`/mission` 永远可用作逃生门 |
| `workingMessage` | `true` | 工作行的流式阶段文案（`🧠 思考中…` / `✍ 撰写回复…`） |
| `fold` | `true` | 分组折叠本身 |
| `neverFold` | `[]` | 保持原生渲染、不折叠的工具名 |
| `autoRow` | `true` | 单调用组不再折成 `▸ 1 次调用`，直接显示那行（`└ ✓ bash …`） |
| `defaultExpand` | `false` | 新分组默认展开（`▾` 头 + 每成员一行明细）；默认仍是折叠，点头部才展开 |
| `pinnedBodyHeight` | `14` | `edit`/`write` 滚动框的视口高度（4–40）；短正文保持自然高度，只有长正文才滚动 |
| `hudEnabled` | `false` | 编辑器下方可选的 3 行 HUD：计划进度 · 运行中任务（转动的 spinner）· 错误/要点计数。点 `⌃Q` 提示可打开面板。 |
| `lang` | `"zh"` | 界面语言默认值；会话内用 `/lang zh\|en` 切换 |
| `style` | `{}` | DIY 显示层：`marker` / `openMarker` / `rowGutter` / `sep` / `icons` / `spinner` 逐项覆盖内置风格，未知或空值不生效；颜色仍走 pi 语义 token，深浅主题都正常。`spinner` 是帧数组（默认盲文 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`，每帧必须单宽，180ms 一帧）。`icons` 有两个特殊键：`mcp`（前缀匹配所有 `mcp__*`）与 `"*"`（兜底，默认 🤖）。图标必须 2 显示格宽，否则摘要行与面板边框会歪 |

> **限制**：`hotkey` 与 `enabled`（reasoning 注入）是**注册期**配置，只认**全局** `settings.json`——pi 1.3.0 在扩展加载期不提供 `getSettings()`，本扩展只能直读全局文件。project settings 里覆盖这两项无效。其余键在 `session_start` 经官方 API 重读，project 覆盖正常合并。
>
> **HUD 只做加法，不替代 footer。** pi 内置 footer 的每个字段——`↑↓` token 数、`$` 费用、上下文占比、缓存命中率、git 分支——全部留在原位；本扩展**从不调用 `setFooter`**，HUD 只是在它上面多加 3 行，且 HUD 开启时 pi-helm 自己的 `setStatus` 行会让位，避免同一批数字出现两次。
>
> ```text
> ⛵ 计划 2/5 · Implement the API layer
> ▸ 运行中 2 · ⠋ bash pnpm test 12s ├ ⠋ read src/app.ts 3s
> ✗ 错误 0 · ✦ 要点 3 · 本轮 +24/−8 · ⌃Q 面板展开
> ~/proj (main) · mysession · ↑12k ↓3.4k · R36k W1.2k · CH87.3% · $0.123 · 45.2%/200k   ← pi 内置 footer，原样不动
> ```
>
> **每行的“在做什么”**：模型传了 `reasoning` 就显示它（`[确认断言]`）；没传则由内置工具描述目录兜底（`[运行命令]`，随 `lang` 切换）。描述是确定性生成的——本项目零 LLM 调用，这是产品红线。

### 防打架契约

pi-helm 的设计目标就是和其它扩展包共处。以下 8 条是它不打架的保证：

| # | 契约 | 实现 |
|---|---|---|
| 1 | **零原型补丁** | 只用 `registerToolRenderer` / `registerTool` / 事件 / `ctx.ui`；绝不 patch pi 内部组件原型（扩展互殴崩溃的根源） |
| 2 | **渲染走解析器链** | `pi.registerToolRenderer((name, next) => …)`：该自绘时才返回，否则 `return next()`。MCP 和第三方工具同样适用，load order 决定风格但绝不崩 |
| 3 | **工具所有权降级梯** | reasoning 头需要拥有工具定义：逐个 `try registerTool(...)`，硬失败（同名已被占）就降级为纯渲染模式——行与折叠保留，reasoning 头去掉，通知一次 |
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
| `intercom`（`alt+m`）等 `alt+…` 快捷键 | 热键冲突 | 默认 `⌃Q`（裸 ctrl 字节，所有终端可用）；`⌥G` 别名需 Option-as-meta——pi 自身的 `⌥Enter`/`⌥↑` 也依赖同一设置（iTerm2：Profiles → Keys → Left Option = `Esc+`；Terminal.app：Use Option as Meta key） |

## 架构

```
src/groups.ts      纯状态机        classifyAssistant · GroupRegistry · buildSummary
                                  · viewPlan · rebuildFromEntries（node --test 直测，零 pi 依赖）
src/strings.ts     中英文词表      摘要/行尾用词 · 工具描述目录（setLang）
src/styles.ts      显示风格        字形/图标/分隔符/spinner · style 深合并
                                  · iconFor 解析 · 面板边框算法
src/width.ts       显示宽度        stringWidth · clipToWidth · cellWidth
                                  （emoji/CJK 双宽；styles 与 renderers 共用）
src/renderers.ts   渲染胶水        fmtSummaryLine / fmtRow / fmtPinned · GroupLine
                                  · 解析器链 · per-call 计时器 · 按显示宽度裁剪
src/index.ts       接线            事件 → registry · 会话恢复重建 · 冲突降级梯
                                  · 任务状态 · 面板 · 药丸卡 · i18n · /helm
index.ts           入口 shim       re-export src/index.ts（包入口）
```

设计遵守官方文档红线：扩展工厂里不启动任何资源；计时器在 `session_start` 或渲染时创建、`session_shutdown` 清理；行为层（药丸卡、计数器）在 JSON/RPC 无头模式下照常可用；颜色全部走语义主题 token（自动适配深浅主题）。

## 开发

```bash
node --test test/groups.test.ts test/lines.test.ts   # 单测
pi -e ./index.ts                                     # 热加载测试
PI_TUI_WRITE_LOG=1 pi -e .                           # 调试原始 ANSI 流
```

设计意图——分层、防打架契约、折叠权衡，以及本项目依赖的 pi 运行时契约——见 [`DESIGN.md`](DESIGN.md)。官方扩展/TUI API 文档：[pi docs](https://github.com/earendil-works/pi)。

重新生成：`node scripts/demo-fold.ts --plain`

<details>
<summary>预览：全部折叠状态（纯文本）</summary>

```
== [1] Folded group (level 0) — three tool calls between two replies ==
▸ 3 calls · 🔨×2 👀×1 · ✗ 1 failed · ↑1.2k ↓169 · 1.9s
  ← one line: counts, icons, failure count, token usage, duration

== [2] Click the summary (level 1) — one row per call, │ gutter ==
▾ 3 calls · 🔨×2 👀×1 · ✗ 1 failed · ↑1.2k ↓169 · 1.9s
└ ✓ bash [check the working tree] git status --short · 4 lines · 100ms
└ ✓ read [see what changed] src/app.ts · 120 lines · 30ms
└ ✗ bash [run the tests] pnpm test · FAIL test/app.test.ts · ↑1.2k ↓169 · 1.8s
  ← ✓/✗ state, reason phrase, target, outcome, usage, duration per row

== [3] Click a row (level 2) — that call's full output ==
▾ 3 calls · 🔨×2 👀×1 · ✗ 1 failed · ↑1.2k ↓169 · 1.9s
└ ✓ bash [check the working tree] git status --short · 4 lines · 100ms
└ ✓ read [see what changed] src/app.ts · 120 lines · 30ms
└ ✗ bash [run the tests] pnpm test · FAIL test/app.test.ts · ↑1.2k ↓169 · 1.8s
FAIL test/app.test.ts
AssertionError: expected 1 to be 2

== [4] Ctrl+O collapse-all — back to the summary line ==
▸ 3 calls · 🔨×2 👀×1 · ✗ 1 failed · ↑1.2k ↓169 · 1.9s

== [5] edit/write never fold — the diff is the point, and it cuts the group ==
✓ ✏️ edit src/app.ts · +1/−1 · ↑800 ↓40 · 300ms · 4 lines
@@ -10,3 +10,3 @@
- const x = 1;
+ const x = 2;
 // untouched
  ← header carries the diff stat, usage and duration; the body is the diff itself

== [6] Long diff — fixed viewport, ▲/▼ indicators, total line count in the header ==
✓ 📝 write src/big.ts · +30/−0 · ↑2.4k ↓310 · 420ms · 31 lines
@@ -1,30 +1,30 @@
+ added line 1
+ added line 2
+ added line 3
+ added line 4
+ added line 5
+ added line 6
+ added line 7
+ added line 8
+ added line 9
+ added line 10
+ added line 11
+ added line 12
+ added line 13
▼ 17 below (wheel)
  ← viewport capped at pinnedBodyHeight (default 14); the wheel scrolls it

== [7] Anti-flicker — a call under 1s stays hidden; from 1s it surfaces with a live clock ==
▸ 2 calls · 🔨×2 · ⠴ 2 running
└ ⠴ bash [rebuild the bundle] pnpm build · running 1.5s
  ← only the call over 1s appears; the short one is hidden on purpose

== [8] Running spinner — the frame comes from the clock, not from state ==
  ⠴ @ 0ms   ⠦ @ 180ms   ⠧ @ 360ms   ⠇ @ 540ms   ⠏ @ 720ms
  ← 180ms per frame, braille, single width (tmux/SSH safe)

== [9] autoRow — a single call shows its row directly, no ▸ 1 call wrapper ==
└ ✓ read [read the entry point] src/index.ts · 42 lines · 60ms
  ← one call = nothing worth summarizing; the row IS the view

== [10] defaultExpand — a new group opens at level 1 without a click ==
▾ 2 calls · 🧲×1 🔦×1 · 30ms
└ ✓ grep [find leftovers] TODO · 2 lines · 20ms
└ ✓ ls [list the sources] src · 3 lines · 10ms
  ← ▾ header + one row per call, straight away

== [11] Iconized summary — tools sharing an icon merge, distinct icons stay separate ==
▸ 7 calls · 🤖×2 🔍×1 🔌×2 🌐×1 🔀×1 · 2.9s
  ← both mcp tools merge into 🔌×2; both unknowns merge into 🤖×2
  ← 🌐 and 🔀 keep their own icons (distinct icons never merge)

== [12] Bilingual word tables — the same summary in zh and en ==
  zh: ▸ 2 次调用 · 🔨×1 👀×1 · 840ms
  en: ▸ 2 calls · 🔨×1 👀×1 · 840ms
  ← same data, two vocabularies; /lang switches live

Every line above came from the real formatters and state machine in src/.
```

</details>

## 路线图

- [ ] 子任务折叠：嵌套调用折成一行可展开（基于 `parentToolCallId`）
- [x] 会话恢复：分组折叠已从 `sessionManager.getBranch()` 重建（任务状态仍为内存态）
- [ ] L2 下钻：面板内回车跳转到对话流对应位置
- [x] 配置：热键 / 折叠 / working message 开关已进 `settings.json`
- [ ] 可选的 AI 摘要层（用便宜模型做回合摘要，默认关闭）

## 致谢

- [pi-tidy](https://github.com/Andy8647/pi-tidy)（MIT）——仅参考分组*语义*：boundary/carrier 分类、1s 防闪延迟、失败粘滞计数、`edit`/`write` 永不折叠。本项目代码全部自写——实例化 `GroupRegistry`（不用模块级全局）、带测试的纯状态机、解析器链而非补丁组件。pi-tidy 有测试是它最对的决定，我们保持这个标准。
- [pi-tidy-tools](https://github.com/mikeyobrien/pi-tidy-tools)（MIT）——reason-first 两行块、self-shell 密度、实时时钟模式
- [Pi](https://github.com/earendil-works/pi) 官方文档与示例——`plan-mode`、`minimal-mode`、`custom-footer`、`entry-renderer`

**溯源**：分组语义于 2026-10-27 研读自 `Andy8647/pi-tidy@main`（`tool-groups.ts`、README）；未复制任何代码——状态机、渲染器与测试均为原创。刻意差异：无模块级全局（多会话/reload 安全）、零原型补丁、思考行有意不折叠、逐行 reasoning 头经 schema 注入实现。

## 许可证

[MIT](LICENSE)
