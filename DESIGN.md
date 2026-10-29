# DESIGN — the intent behind pi-helm

> Purpose: pin the architecture decisions, contracts and trade-offs in the repository so any contributor can take over.
> The factual baseline is the README; this file explains **why**. When they disagree, the code and README win.

## 1. Three-layer split

```
Layer 1  src/groups.ts     pure state machine
         src/strings.ts    zh/en word tables (pure data + setLang)
         src/styles.ts     display style + DIY merge + icon resolution (pure data)
         src/width.ts      display-width helpers (emoji/CJK are double width; shared)
Layer 2  src/renderers.ts  render glue
Layer 3  src/index.ts      wiring (events / degrade ladder / panel)
         index.ts          entry shim (re-exports src/index.ts)
```

| Layer | Responsibility | Forbidden | Testing |
|---|---|---|---|
| L1 `groups.ts` | boundary/carrier/plain classification, the group registry, summary building, `viewPlan`, `rebuildFromEntries` | no pi import, no theme, no side effects, no module globals (instantiate the registry — avoids multi-session/reload races) | `node --test` directly |
| L1 `strings.ts` | summary/row vocabulary (call/failed/running/lines/done) + the tool description catalog | no pi import; interface words only, no business logic | assert after `setLang` |
| L1 `styles.ts` | built-in glyphs/icons/separator; deep merge of the `style` settings; `iconFor` resolution (exact → `mcp` prefix → `*` fallback); panel rule widths | no pi import; no colors (colors belong to theme tokens) | merge/override/icon/rule tests |
| L1 `width.ts` | display-width helpers (`stringWidth`/`clipToWidth`/`cellWidth`): emoji/CJK double width, VS16 widening, ZWJ clusters, zero-width marks | no pi import; shared by renderers and styles (hence its own module — importing across would create a cycle) | width assertions |
| L2 `renderers.ts` | line formatting (`fmtSummaryLine`/`fmtRow`/`fmtPinned`), the self-shell `GroupLine`, the `registerToolRenderer` resolver chain, per-call timers, cell-aware clipping | only structural code can be tested directly — never import the pi runtime | import this module and test |
| L3 `index.ts` | events → registry, session-restore rebuild, conflict ladder, task state, overlay, pills, i18n, `/helm` | no testable business logic | manual / integration |

**Why this split:** the folding semantics (the part most likely to break) must run in unit tests without a pi environment; rendering and wiring each depend only on the layer below, one direction, no cycles.

**Official red lines** (never violate): start no resources in the extension factory; create timers in `session_start` or at render time and clear them in `session_shutdown`; keep behavior (pills, counters) working headless in JSON/RPC modes; take every color from a semantic theme token.

## 2. The 8 No-Fight contracts (see the README table)

1. **Zero prototype patches** — only `registerToolRenderer`/`registerTool`/events/`ctx.ui`; patching prototypes is the root cause of extension-vs-extension crashes.
2. **Rendering goes through the resolver chain** — `(name, next) => …`; `return next()` when we do not draw. Load order decides style, never a crash.
3. **Tool-ownership degrade ladder** — the reasoning head needs the tool definition; a hard `registerTool` failure degrades to render-only mode (rows and folding stay, the reasoning head goes) plus one notification.
4. **Namespace isolation** — every UI key carries the `pi-helm:` prefix (`setStatus`, the pill `customType`); the v2 legacy `mission-pill` must still render.
5. **Configurable hotkey** — default `⌃Q` (a bare ctrl byte, works in every terminal); `/mission` is the permanent escape hatch.
6. **Working-message etiquette** — `setWorkingMessage` only on a phase change; restore the default at `turn_end`.
7. **Idempotent lifecycle** — the factory starts nothing; handlers are idempotent; reload can repeat.
8. **One-key exit** — `/helm off|on|toggle` plus `"enabled": false`.

**Status of these contracts:** they are hard constraints for coexisting with other extensions. If a new feature collides with one, change the design — do not route around a contract.

## 3. Panel / folding trade-offs

- **What folds:** only the tool calls between two pieces of assistant text. A `carrier` (thinking + calls, no text) joins the current group; a `boundary` (visible text) splits the group and always renders — **folding hides tool noise, never prose**. That is the fundamental difference from "rearrange the whole screen" approaches.
- **Anti-flicker:** a call running under 1s never surfaces (`RUNNING_ROW_DELAY_MS`); a row that pops in and folds back a frame later is louder than no folding at all.
- **Failures stick to the summary:** `N failed` in red on the summary line instead of a column of red rows; an error is never silently folded away.
- **edit/write never fold** and cut the group: the diff is the point, and calls after one start a fresh group (better one extra folded line than a buried diff).
- **Reason-first:** each row leads with a `reasoning` phrase (a guided, optional schema field stripped before execution — no model-behavior change): the summary answers "what ran", the reason answers "why". When the model sends none, the `strings.ts` catalog fills in (`[run command]`), **generated deterministically — zero LLM calls is a product red line**; the two never appear together (reason wins).
- **Three levels:** level 0 summary row → level 1 row list → level 2 one call's full output; `Ctrl+O` toggles the whole group. Folding is pure view state, rebuilt from `sessionManager.getBranch()` on restore.
- **Single calls do not fold (`autoRow`):** a one-member group has nothing worth summarizing — `▸ 1 call · bash×1` carries less information than the row it hides, so the row renders directly (no header, no `└` gutter, because there is no summary above to connect to); as soon as the group has more members it folds again. The anti-flicker delay does not apply: the row *is* the view, so it cannot "pop in and retract". Disable with `"autoRow": false`.
  - **But an explicit collapse-all must still reach it** (defect found in code review 2026-10-28): `Ctrl+O` collapse-all did nothing to a one-member group — the `solo` branch ignored `level`. Fix: `Group.soloFolded` marks "level 0 because the user folded it" — a fresh one-member group is level 0 by construction (`openGroup` seed), so the naive "solo respects level" would fold them all by default and silently kill `autoRow`. Only `noteSetExpanded(collapse)` sets it; expanding clears it; fresh groups are untouched.
  - **Structural invariant** (confirmed in review; this is what makes the soloFolded design sound): `solo=true` → viewPlan takes the solo branch → `header` is always null → a fresh solo group has no header to click → **`toggleHeader` is structurally unreachable for a fresh solo group**. Therefore the naive trigger state ("one member + soloFolded=false + level 1 + has header") cannot exist, and toggleHeader can only ever hit a one-member group that already has `soloFolded=true` — there is no third path that could set or clear the flag wrongly.
- **Open by default (`defaultExpand`, design decision):** opening new groups at level 0 (folded) optimizes for space; users who want detail up front enable this switch — new groups start at level 1 (`▾` header + one row per member). It only affects newly created groups (applied in `openGroup`); a level already set on an existing group is never rewritten by a live config change, and a session-restore rebuild follows the current setting. Orthogonal to `autoRow`: one-member groups still prefer the direct row.
- **Iconized summary:** `▸ 5 calls · 🔨×3 👀×2` — icons let you scan tool types at a glance. Only the presentation changes; no extra lines.
- **The panel (`/mission`) is an overlay, not a replacement:** Esc closes it instantly and it never interrupts a running turn; pills are injected via `appendEntry` and never enter the LLM context.
- **One built-in style plus a DIY interface:** no theme presets (high maintenance, and a false promise — there is no real "Google style" in a terminal). One classic glyph set ships built in, and `settings.style` overrides it item by item (`marker`/`openMarker`/`rowGutter`/`sep`/`icons`/`spinner`); empty or unknown values are ignored (a typo must not blank the UI). Colors stay closed — theme tokens are what make dark/light adaptation and contract #1 work.
- **Running spinner (frame derived from the clock):** braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (10 frames, all single width, tmux/SSH safe), 180 ms per frame (≈5.6 fps, soft). Frame index = `frames[floor(now/180) % len]` — **no new state**, every call site at the same instant computes the same frame, and tests can pin `now`. Applied in four places: the row glyph, the summary's running segment, and the panel's task header and task rows. The panel's current-step `▶` is **left alone** — it marks position, not activity. Ticker rate follows the frame rate: the per-call timer runs at 180 ms (1 s looked frozen), the panel timer runs at 180 ms but returns early when idle so nothing repaints; the panel cache key must include the current frame, otherwise the cache swallows the animation. The anti-flicker `RUNNING_ROW_DELAY_MS` and the reveal timers are **untouched**.
- **Display-width clipping:** emoji and CJK occupy two cells; clipping by UTF-16 units (the old code) cuts rows short or splits an emoji. `stringWidth`/`clipLine` count display cells (including VS16 widening, ZWJ clusters and zero-width marks), with no pi dependency.
- **edit/write scroll box (2026-10-28):** long diffs get a fixed viewport (`pinnedBodyHeight`, default 14), a total line count in the header, and wheel scrolling. **The official ScrollView was rejected** (the initial plan): ① `routeWheel` only searches the layout tree for `box.scrollView`, and the layout tree only descends into components implementing `[LAYOUT_NODE]` — the transcript's `documentContainer` is a plain Container, so a nested ScrollView never enters the wheel search set; ② a ScrollView's `render()` returns all lines and viewport clipping happens in `layoutComponent`'s scroll branch — outside the layout tree there is no fixed height; ③ making it work would require threading LAYOUT_NODE through pi's container chain = a prototype patch = violating contract #1. **Implementation instead:** the wheel event reaches our GroupLine through the chain pi already provides (`parseWheelEvent → dispatchMouseToLayout → Container.handleMouse` delegation, verified in source) and we manage `scrollTop` ourselves; **contain semantics** — at the boundary the event is still consumed (`render:false`) so the transcript never jumps under the cursor, while short content returns `undefined` and lets global scrolling proceed. If pi ever puts tool cards into the layout tree, this can migrate back to ScrollView.

## 4. Provenance

- Grouping semantics absorbed from pi-tidy (MIT, Andy8647/pi-tidy): boundary/carrier classification, the 1 s anti-flicker delay, the failure count on the summary, edit/write never folding.
- **What we changed:** pi-tidy's module globals became an instantiated registry (multi-session/reload races); the reason-first rows, execution clock, pills and panel are our own.
- **Why it is better:** zero prototype patches plus a resolver chain let pi-helm coexist with other rendering extensions (pi-tidy is an independent implementation — on a style clash you can only run one); after the split, the folding semantics are directly testable.
- Plan parsing (`Plan:` / `[DONE:n]`) follows the official plan-mode example.

## 5. Open questions / boundaries

- Upstream comparison: the repository has no git remote yet, so "latest" only means local HEAD.
- The known-conflict matrix (pi-tidy, tool-definition owners, `alt+…` hotkeys) lives in the README.
- **pi runtime contract (pinned 2026-10-28):** `renderResult(result, options, theme, context)` — `options` is only `{expanded, isPartial}`; `durationMs` and `isError` live on `context` (`tool-execution.js`, getRenderContext). Reading the wrong object is exactly the "missing tail" class of bug; before changing anything here, check `ToolRenderResultOptions`/`ToolRenderContext` in pi's `dist/core/extensions/types.d.ts`.
- **pi 1.3.0 settings trap (confirmed 2026-10-28; once made every setting silently inert):** `pi.getSettings()` **always throws** during extension loading (`Extension runtime not initialized`) — `runtime.getSettings` is only wired in `runner.bindCore()`, after every factory has run. A try/catch in the factory swallows it, so every setting silently runs on its default. The correct approach: **read the file in the factory** (`join(getAgentDir(), "settings.json")` for the global config) plus **re-read through the official API on `session_start`**, when the runtime is live and project overrides merge in. The cost: keys that must be known at registration time (`hotkey`, `enabled` → reasoning injection) only honor the global file — project-level values for those two are ignored, documented in the README. Lesson: **a silent catch block is the perfect incubator for this class of bug — if you swallow an error, leave a visible trace.**
- pi exposes only `getSettings()` (read) to extensions, with no official write path — so `/lang` currently changes session memory only and resets on restart; persisting it means writing `"lang"` into `settings.json` yourself (documented). We do not write a user's settings file on our own.
