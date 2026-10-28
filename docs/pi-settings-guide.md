# pi `/settings` 逐项说明

> 依据：pi 1.3.0 源码（`settings-selector.js`、`settings-defaults.js`、`settings-schema.js`），逐条摘录官方描述并翻译整理。
> 用法：pi 内敲 `/settings` 打开本菜单；改动即时生效（部分持久化到 `~/.pi/agent/settings.json`）。

## 内容与思考

| 设置 | 作用 | 效果 / 建议 |
|---|---|---|
| **Hide thinking** ✅ | 思考块折叠成一行标签 | 长篇英文消失，点 `✻ thinking…` 逐段展开/收回 |
| **Default thinking level per model** | 每个模型的默认思考档位 | **日常调 low/medium**——源头减少思考量（比 Hide 更治本，还省 token） |
| Cache warming | 智能预热 prompt 缓存 | `streaming` 默认即可，省费用；本地模型可关 |

## 上下文与成本

| 设置 | 作用 | 效果 / 建议 |
|---|---|---|
| **Auto-compact** | 上下文将满时自动压缩会话 | 默认开，**建议保持开** |
| Warnings / Anthropic extra usage | 订阅用户可能产生**计费**额外用量时警告 | 默认开，别关 |
| HTTP idle timeout | 本地/慢模型连接卡顿的超时阈值 | 默认即可 |
| Transport | 供应商支持多种传输协议时的偏好 | 默认 |
| Session share destination | `/share` 上传去处 | Auto = 有 GitHub Gist 凭据传 Gist，否则 Radius |

## 终端界面

| 设置 | 作用 | 效果 / 建议 |
|---|---|---|
| **TUI mode** | fullscreen（全屏，自带滚动条）/ regular（终端原生回退） | 保持 fullscreen；想回退终端原生滚动历史用 regular |
| Fullscreen exit output | 退出全屏时打印完整记录还是只留恢复提示 | `transcript` 即可 |
| Fullscreen scrollbar | 全屏滚动条样式 | 默认 |
| Fullscreen copy on select | 选中即复制（关闭则用 `Ctrl+X` 复制） | 默认 |
| Fullscreen wheel scrolling | 每次滚轮翻几行；auto 会在快滚时加速 | 默认 |
| Theme | 界面配色主题 | 配合终端；浅色验证也用它 |
| Show images | 终端内联显示图片 | 默认开 |
| Image width | 图片显示宽度（单元格） | 默认 |
| Auto-resize images | 大图缩到 2000×2000 以内，提高模型兼容性 | 默认开 |
| Block images | 禁止把图片发给模型供应商 | 默认关 |
| **Clear on shrink** | 窗口缩小时清空空白行 | 关着（可能闪烁），有残影再开 |
| **Terminal progress** | 标签页进度指示（OSC 9;4） | iTerm2 用户开着好看 |
| Show hardware cursor | 用终端真实光标 | 按喜好 |
| Double-escape action | 空编辑器连按 Esc 的动作 | 默认 tree |
| Editor padding | 输入框左右留白（0-3） | 默认 |
| Output padding | 消息/工具输出/命令输出左右留白 | 输出内容多可试 1 |
| Autocomplete max items | 下拉候选最大条数（3-20） | 默认 5 |

## 启动与杂项

| 设置 | 作用 | 效果 / 建议 |
|---|---|---|
| **Quiet startup** | 启动时不打印模型清单等噪音 | **建议开** |
| Collapse changelog | 更新后更新日志折叠显示 | 开 |
| Install telemetry | 匿名版本更新 ping | 按隐私偏好选择（可关） |
| **Default project trust** | 进入新目录时的信任策略：ask / always / never | 按需；嫌烦可 always（自己权衡安全） |
| Tree filter mode | `/tree` 会话树默认过滤：default / no-tools / user-only / labeled-only / all | 默认 |
| Cache miss notices | 转录里显示缓存未命中/供应商恢复诊断 | 排障时开，平时关 |
| Mermaid diagrams | mermaid 代码块画成字符图：off / final / streaming | 用得着就 `final` |
| **Skill commands** | 把技能注册成 `/skill:name` 命令 | 建议开（方便调用） |

## 与 pi-helm 的关系

- `Hide thinking` 管思考（一行标签 + 点击展开）；pi-helm 管工具调用（分组折叠 + 点击展开）。
- 两者互补后整条转录形态：**思考 1 行 + 工具 1 行**，点哪行看哪行。
- pi-helm 自己的开关在 settings.json 的 `pi-helm` 键（`enabled` / `hotkey` / `workingMessage` / `fold` / `neverFold`），与本菜单互不影响。
