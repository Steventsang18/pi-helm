# pi-helm ⛵

**Mission control for your Pi session.** Keep a long terminal session readable: tool noise folds into one line per reply segment, every row leads with *why*, and mission state — plan progress, running tasks, key points — sits one keystroke away.

> Terminal sessions get loud: tool calls, diffs, thinking, subagents. pi-helm folds the tool noise into one summary line per reply segment, keeps the rows reason-first, and puts mission state one keystroke away.

*中文版：[README.zh-CN.md](README.zh-CN.md)*

---

## Features

| | Feature | What it does |
|---|---|---|
| ⛵ | **Mission overlay** | `⌃Q` (or `/mission`) opens a dashboard: PLAN progress bar · running TASKS with live elapsed · KEY POINTS feed. Esc closes instantly and never blocks the running turn. |
| 🗂 | **Group folding** | Every tool call between two pieces of assistant text folds into one summary line — `▸ 5 calls · ⚡×3 📖×2 · ✗ 1 failed · 1.2s`. Click the line to unfold the row list (`│` gutter), click a row for its full output. Calls running under 1s never flash a row; failures stick to the summary as `✗ N failed`; edit/write never fold (the diff is the point). |
| 📖 | **Reason-first rows** | Each row leads with the **why** — a `reasoning` phrase the model is guided to pass: `│ ✗ bash [check test failures] pnpm test · exit 1 · 1.8s`. When the model sends none, a built-in bilingual tool catalog fills the slot. |
| ⏱ | **Live execution clock** | While a tool runs, its card shows a braille spinner plus the elapsed time ticking live; it settles into `✓ done 2.3s` (green) or `✗ error` (red). Errors are never silently collapsed. |
| 📊 | **Plan progress** | Parses `Plan:` numbered steps + `[DONE:n]` markers from agent output (same approach as the official plan-mode example). Progress bar in the overlay and footer. |
| 🔑 | **Key-point feed** | Tool errors and milestones are captured deterministically and stamped as pill cards in the transcript (kept out of the LLM context via `appendEntry`). A turn's file changes are auto-summarized as `Turn changes: N files · +a/-b`. |
| 🎚 | **Streaming phase indicator** | The status line live-switches between `✻ thinking…` and `✍ writing…` while the assistant streams. |
| 🌐 | **i18n** | Interface strings in Chinese or English, switch any time with `/lang zh|en`. Prompt-side text stays English. |

Zero runtime dependencies beyond Pi's own packages. Pure rendering: no Pi source changes, no LLM calls, no model-behavior changes (the `reasoning` param is a guided, optional schema field stripped before execution).

## Install

Tested with pi 1.3.0.

```bash
pi install /path/to/pi-helm
```

This registers the package in `~/.pi/agent/settings.json`. **Restart pi** afterwards — `/reload` cannot swap already-loaded ESM modules.

### Verify it works

1. Restart pi.
2. Ask for anything that runs tools (e.g. "run the tests").
3. You should see the tool calls folded into one summary line with a `▸` marker, e.g. `▸ 2 calls · ⚡×1 📖×1 · 1.1s`.

If you see pi's default tool boxes instead, the extension did not load — check `/mission` (it should open the overlay) and pi's startup output for extension errors.

### Alternatives

```bash
pi -e /path/to/pi-helm/index.ts   # one-off trial, nothing installed
cp -r src index.ts ~/.pi/agent/extensions/pi-helm/   # manual copy, then restart pi
```

## Usage

| Key / Command | Action |
|---|---|
| `⌃Q` · `⌥G`* · `/mission` | Open / close the overlay (*`⌥G` needs Option-as-meta in your terminal) |
| `/lang zh` · `/lang en` | Switch interface language |
| `/milestone <text>` | Stamp a milestone pill (not sent to the LLM) |
| `/demo-seed` | Inject a fake mission for an instant preview |
| `/demo-clear` | Reset mission state |
| `/helm off` · `/helm on` · `/helm toggle` | One-key exit: disable / re-enable pi-helm rendering |
| `Ctrl+O` | Native expand: toggles every group between summary and full output |

Plan progress activates automatically when the agent emits:

```
Plan:
1. First step
2. Second step
```

and marks steps done with `[DONE:n]` markers.

## Group folding

Three levels, one click at a time:

```
 ▸ 5 calls · ⚡×3 📖×2 · ✗ 1 failed · 1.2s             ← level 0: folded to one line
 ▾ 5 calls · ⚡×3 📖×2 · ✗ 1 failed · 1.2s             ← level 1: click the summary
 │ ✓ bash [check test failures] pnpm test · exit 1 · 1.8s
 │ ✓ read src/app.ts · 120 lines · 0.0s
 │ ✗ bash [verify the fix] pnpm test · exit 1 · 1.2s   ← level 2: click a row
 │   …full output / diff here…

 └ ✓ bash [run command] pnpm test · exit 1 · 1.8s      ← single call: no wrapper, the row IS the view
```

- **Single calls don't fold (`autoRow`):** a one-call group has nothing worth summarizing — `▸ 1 call · bash×1` hides what it *did*, so the row shows directly. Multi-call groups still fold.
- **What folds:** every tool call between two pieces of assistant text. A step that only thinks and calls a tool does not split the group (a "carrier"); visible text does (a "boundary") and always renders — folding hides nothing but tool noise.
- **Anti-flicker:** a call running under 1s never announces itself inside a folded group (a single call's row is live from the first frame — it *is* the view); failures are counted on the summary line instead of hanging red rows under a folded group.
- **Never folded:** `edit` / `write` — their diff is the point, with `+12/−3` stats and `↑↓` usage in the tail, and the body scrolls in a fixed viewport. They also cut the group; calls after one start a fresh group.
- **`Ctrl+O`** still expands everything and collapses back to the summary; clicking a full box folds just that one.
- **Restore-safe:** on session resume the groups rebuild from the saved branch, so folding survives a restart.

## Configuration

`~/.pi/agent/settings.json`, then **restart pi** (`/reload` cannot swap already-loaded ESM):

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
    "lang": "en",
    "style": { "marker": "▸", "icons": { "bash": "⚡" }, "spinner": ["⠋", "⠙", "⠹"] }
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch (same as `/helm off`) |
| `hotkey` | `"ctrl+q"` | Dashboard hotkey; `/mission` always works as the escape hatch |
| `workingMessage` | `true` | Streaming phase text in the working line (`✻ thinking…` / `✍ writing…`) |
| `fold` | `true` | Group folding itself |
| `neverFold` | `[]` | Tool names that keep their own rendering untouched |
| `autoRow` | `true` | A one-call group skips the `▸ 1 call` wrapper and shows its row directly (`└ ✓ bash …`) |
| `defaultExpand` | `false` | New groups open expanded (`▾` header + one row per call); by default they stay folded until the header is clicked |
| `pinnedBodyHeight` | `14` | Viewport height (4–40) for the edit/write scroll box; short bodies stay natural-height, only longer ones scroll |
| `lang` | `"en"` | Interface language default; flip per session with `/lang zh\|en` |
| `style` | `{}` | DIY display layer: override `marker` / `openMarker` / `rowGutter` / `sep` / `icons` / `spinner` item by item; unknown or empty values are ignored; colors stay pi semantic theme tokens so dark and light themes both work. `spinner` is a frame array (default braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`; every frame must be single-width; 180 ms per frame). `icons` has two special keys: `mcp` (prefix-matches every `mcp__*`) and `"*"` (fallback, default 🤖). Icons must be two display cells wide, or summary rows and panel borders bend |

> **Limits.** `hotkey` and `enabled` (reasoning-schema injection) are registration-time settings, so they only honor the **global** `settings.json`: pi 1.3.0 does not expose `getSettings()` while an extension loads, and the extension reads the global file directly. Project-level overrides of those two keys are ignored. Every other key is re-read through the official API on `session_start`, where project overrides merge normally.
>
> **Per-row "what did this call do?"** The model's `reasoning` wins (`[check failures]`); when absent, the built-in tool catalog fills the slot (`run command`, following `lang`). Descriptions are generated deterministically — this project makes zero LLM calls, and that is a product red line.

### No-Fight Contract

pi-helm is built to sit next to other extension packages. The rules that make that possible:

| # | Contract | How |
|---|---|---|
| 1 | **Zero prototype patches** | Only `registerToolRenderer` / `registerTool` / events / `ctx.ui` — never a monkey-patch of pi internals (the root cause of extension-vs-extension crashes) |
| 2 | **Resolver-chain rendering** | `pi.registerToolRenderer((name, next) => …)`: draw only when we own the row, otherwise `return next()`. MCP and third-party tools are covered; load order decides the style, never a crash |
| 3 | **Tool-ownership ladder** | The reasoning head needs the tool definition: we `try registerTool(...)` per tool and on a hard failure (a name owned elsewhere) degrade to render-only mode — rows and folding stay, the reasoning head goes, one notification |
| 4 | **Namespaced UI keys** | Every key carries the `pi-helm:` prefix (`setStatus`, pill `customType`) — nobody else's slots |
| 5 | **Configurable hotkey** | `"pi-helm": { "hotkey": "ctrl+q" }`; known clashes listed below; `/mission` is the always-available escape hatch |
| 6 | **Working-message etiquette** | `setWorkingMessage` only on phase change, restored at `turn_end`, switchable off via `workingMessage: false` |
| 7 | **Idempotent lifecycle** | The factory starts nothing; timers are created at render time and cleared in `session_shutdown`; handlers are idempotent |
| 8 | **One-key exit** | `/helm off\|on\|toggle` and `"enabled": false` |

### Known conflicts

| Partner | Symptom | Mitigation |
|---|---|---|
| Another folding / tool-card extension (e.g. [pi-tidy](https://github.com/Andy8647/pi-tidy)) | Both register tool renderers; load order decides whose card style wins — never a crash | Run one folding extension at a time, or list its tools in `neverFold` |
| Extensions that own the `bash` / `read` / … tool definitions | Our `registerTool` hard-fails | Automatic: render-only mode + one notice (contract #3) |
| `intercom` (`alt+m`) and other `alt+…` shortcuts | Hotkey clash | Defaults to `⌃Q` (plain ctrl, works everywhere); the `⌥G` alias needs Option-as-meta — the same setting pi's own `⌥Enter` / `⌥↑` need (iTerm2: Profiles → Keys → Left Option = `Esc+`; Terminal.app: Use Option as Meta key) |

## Architecture

```
src/groups.ts      pure state machine   classifyAssistant · GroupRegistry · buildSummary
                                        · viewPlan · rebuildFromEntries (node --test, no pi import)
src/strings.ts     zh/en word tables    summary/row vocabulary · tool description catalog (setLang)
src/styles.ts      display style        glyphs/icons/separator/spinner · style deep-merge
                                        · iconFor resolution · panel rule math
src/width.ts       display width        stringWidth · clipToWidth · cellWidth
                                        (emoji/CJK double width; shared by styles + renderers)
src/renderers.ts   render glue          fmtSummaryLine / fmtRow / fmtPinned · GroupLine
                                        · resolver chain · per-call timers · cell-aware clipping
src/index.ts       wiring               events → registry · session restore · conflict ladder
                                        · mission state · overlay · pills · i18n · /helm
index.ts           entry shim           re-exports src/index.ts (package entry point)
```

Design constraints honored from the official docs: no resources started in the extension factory; timers created in `session_start` or at render time and cleared in `session_shutdown`; behavior (pills, counters) works headless in JSON/RPC modes; all colors are semantic theme tokens (automatic dark/light adaptation).

## Development

```bash
node --test test/groups.test.ts test/lines.test.ts   # unit tests
pi -e ./index.ts                                     # hot-test
PI_TUI_WRITE_LOG=1 pi -e .                           # debug the raw ANSI stream
```

Design rationale — layering, the No-Fight contract, folding trade-offs and the pi runtime contracts this project depends on — lives in [`DESIGN.md`](DESIGN.md). Official extension/TUI API docs: [pi docs](https://github.com/earendil-works/pi).

## Roadmap

- [ ] Sub-agent folding: collapse nested calls into one expandable row (via `parentToolCallId`)
- [x] Session-restore: fold groups rebuild from `sessionManager.getBranch()` (mission state stays in-memory)
- [ ] L2 drill-down: Enter in the overlay jumps to the transcript position
- [x] Config: hotkey / fold / working-message switches in `settings.json`
- [ ] Optional AI digest layer (cheap-model turn summaries, off by default)

## Acknowledgements

- [pi-tidy](https://github.com/Andy8647/pi-tidy) (MIT) — grouping *semantics* only: boundary/carrier classification, the 1s anti-flicker delay, sticky failure count, edit/write never folding. Every line here is written from scratch — instance-based `GroupRegistry` (no module globals), a pure state machine with tests, and a resolver chain instead of patched components. Having tests was pi-tidy's best decision; we kept that bar.
- [pi-tidy-tools](https://github.com/mikeyobrien/pi-tidy-tools) (MIT) — reason-first two-line blocks, self-shell density, live elapsed clock pattern
- [Pi](https://github.com/earendil-works/pi) official docs & examples — `plan-mode`, `minimal-mode`, `custom-footer`, `entry-renderer`

**Provenance:** semantics studied from `Andy8647/pi-tidy@main` (`tool-groups.ts`, README) on 2026-10-27; nothing copied — the state machine, renderers and tests are original. Deliberate differences: no module-level globals (multi-session/reload safe), zero prototype patches, thinking rows intentionally not folded, and a per-row reasoning head via schema injection.

## License

[MIT](LICENSE)
