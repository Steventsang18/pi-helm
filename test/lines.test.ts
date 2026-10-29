/**
 * Line formatting tests — pure + resolver-chain contract.
 * Written first (red), then implemented by src/renderers.ts (green).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GroupLine, activeTimerCount, createToolResolver, disposeAllRenderers, fmtDuration, fmtPinned, fmtRow, fmtSummaryLine, outcomeOf, stringWidth, type ThemeLike } from "../src/renderers.ts";
import { GroupRegistry, buildSummary, type GroupSummary, type ToolCallRecord } from "../src/groups.ts";
import { DEFAULT_SPINNER } from "../src/styles.ts";

/** Identity theme: assert on the plain text shape. */
const th: ThemeLike = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

// ─────────────────────────────────────────────────────────────────────────────
// fmtDuration
// ─────────────────────────────────────────────────────────────────────────────

test("fmtDuration: ms / s / m+s", () => {
	assert.equal(fmtDuration(undefined), "");
	assert.equal(fmtDuration(300), "300ms");
	assert.equal(fmtDuration(1200), "1.2s");
	assert.equal(fmtDuration(75_000), "1m15s");
});

// ─────────────────────────────────────────────────────────────────────────────
// fmtSummaryLine
// ─────────────────────────────────────────────────────────────────────────────

const summary: GroupSummary = {
	count: 5,
	breakdown: [
		{ name: "bash", count: 3 },
		{ name: "read", count: 2 },
	],
	failed: 2,
	running: 1,
	durationMs: 1200,
};

test("spinner ticker: one clock per running call, cleared when it settles (no leak)", async () => {
	disposeAllRenderers();
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true });
	const mine = resolver("bash", () => undefined) as any;
	const ctx = { toolCallId: "spin-1", args: { command: "sleep 5" }, isPartial: true, expanded: false, invalidate: () => {} };

	assert.deepEqual(activeTimerCount(), { clocks: 0, reveals: 0 }, "factory starts no timers");
	mine.renderCall(ctx.args, th, ctx);
	assert.equal(activeTimerCount().clocks, 1, "a running call owns exactly one clock");

	const done = { ...ctx, isPartial: false, durationMs: 10, isError: false };
	mine.renderResult({ content: [] }, { expanded: false, isPartial: false }, th, done);
	assert.equal(activeTimerCount().clocks, 0, "settling clears the clock");

	disposeAllRenderers();
	assert.deepEqual(activeTimerCount(), { clocks: 0, reveals: 0 }, "shutdown leaves nothing behind (contract #7)");
});

// Running segments now animate: assert against an explicit frame so the test
// never depends on the wall clock (fixed now → deterministic frame).
const F0 = "⠋"; // spinnerFrame(0) === frames[0]

test("fmtSummaryLine: marker, count, icon breakdown, failed, running, duration", () => {
	assert.equal(fmtSummaryLine(summary, 0, th, undefined, F0), "▸ 5 calls · ⚡×3 📖×2 · ✗ 2 failed · ⠋ 1 running · 1.2s");
	assert.equal(fmtSummaryLine(summary, 1, th, undefined, F0), "▾ 5 calls · ⚡×3 📖×2 · ✗ 2 failed · ⠋ 1 running · 1.2s");
});

test("fmtSummaryLine: unknown tools collapse to the fallback icon", () => {
	// Unknown tools show 🤖, so two different unknown tools merge into
	// 🤖×2 — accepted trade-off (icon grouping over name fidelity).
	const s: GroupSummary = { count: 2, breakdown: [{ name: "mcp__docs__search", count: 2 }], failed: 0, running: 0, durationMs: 0 };
	assert.equal(fmtSummaryLine(s, 0, th), "▸ 2 calls · 🔌×2", "mcp__* shares the mcp icon");
	const unknown: GroupSummary = { count: 2, breakdown: [{ name: "my_custom_tool", count: 2 }], failed: 0, running: 0, durationMs: 0 };
	assert.equal(fmtSummaryLine(unknown, 0, th), "▸ 2 calls · 🤖×2");
});

test("fmtSummaryLine: zh words (setLang) and DIY style glyphs", async () => {
	const { setLang } = await import("../src/strings.ts");
	const { mergeStyle } = await import("../src/styles.ts");
	setLang("zh");
	try {
		assert.equal(fmtSummaryLine(summary, 0, th, undefined, F0), "▸ 5 次调用 · ⚡×3 📖×2 · ✗ 2 次失败 · ⠋ 1 个运行中 · 1.2s");
	} finally {
		setLang("en");
	}
	const diy = mergeStyle({ marker: "❯", openMarker: "⌄", rowGutter: "┆", sep: "|", icons: { bash: "BASH" } });
	assert.equal(fmtSummaryLine(summary, 0, th, diy, F0), "❯ 5 calls | BASH×3 📖×2 | ✗ 2 failed | ⠋ 1 running | 1.2s");
	// custom icon never drops the other defaults
	assert.equal(diy.icons.read, "📖");
});

test("fmtSummaryLine: quiet group omits failed/running/duration", () => {
	const quiet: GroupSummary = { count: 1, breakdown: [{ name: "read", count: 1 }], failed: 0, running: 0, durationMs: 0 };
	assert.equal(fmtSummaryLine(quiet, 0, th), "▸ 1 call · 📖×1");
	assert.equal(fmtSummaryLine({ count: 0, breakdown: [], failed: 0, running: 0, durationMs: 0 }, 0, th), "▸ 0 calls");
});

// ─────────────────────────────────────────────────────────────────────────────
// fmtRow
// ─────────────────────────────────────────────────────────────────────────────

test("fmtRow: gutter, glyph, reasoning head, detail, outcome, duration", () => {
	const line = fmtRow(
		{
			status: "error",
			toolName: "bash",
			reasoning: "确认哪个断言挂了",
			detail: "pnpm test",
			outcome: "exit 1",
			durationMs: 1800,
		},
		th,
	);
	assert.equal(line, "└ ✗ bash [确认哪个断言挂了] pnpm test · exit 1 · 1.8s");
});

test("fmtRow: ok glyph, no reasoning, no gutter on request", () => {
	assert.equal(fmtRow({ status: "ok", toolName: "read", detail: "src/app.ts", outcome: "12 lines", durationMs: 300 }, th), "└ ✓ read src/app.ts · 12 lines · 300ms");
	assert.equal(fmtRow({ status: "ok", toolName: "read", outcome: "12 lines" }, th, false), "✓ read · 12 lines");
});

test("fmtRow: running glyph is the spinner frame and live outcome", () => {
	assert.equal(
		fmtRow({ status: "running", toolName: "bash", detail: "pnpm test", outcome: "running 2s", frame: F0 }, th),
		"└ ⠋ bash pnpm test · running 2s",
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// fmtPinned
// ─────────────────────────────────────────────────────────────────────────────

test("fmtPinned: always-shown tool card header", () => {
	assert.equal(
		fmtPinned({ status: "ok", toolName: "edit", icon: "✏️", label: "~/src/app.ts", outcome: "+12/−3", durationMs: 300 }, th),
		"✓ ✏️ edit ~/src/app.ts · +12/−3 · 300ms",
	);
	assert.equal(fmtPinned({ status: "error", toolName: "write", label: "x.ts", outcome: "denied" }, th), "✗ write x.ts · denied");
});

// ─────────────────────────────────────────────────────────────────────────────
// Resolver-chain contract (§No-Fight Contract #2)
// ─────────────────────────────────────────────────────────────────────────────

test("resolver: unknown-to-us work still returns our self-shell renderers (folding covers MCP)", () => {
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true });
	const fallback = { renderShell: "default" };
	const mine = resolver("mcp__docs__search", () => fallback) as any;
	assert.notEqual(mine, fallback);
	assert.equal(mine.renderShell, "self");
	assert.equal(typeof mine.renderCall, "function");
	assert.equal(typeof mine.renderResult, "function");
});

test("resolver: disabled or neverFold tools pass through untouched (return next())", () => {
	const registry = new GroupRegistry();
	const fallback = { renderShell: "default" };

	const off = createToolResolver({ registry, enabled: () => false });
	assert.equal(off("bash", () => fallback), fallback);
	assert.equal(off("bash", () => undefined), undefined);

	const gated = createToolResolver({ registry, enabled: () => true, neverFold: ["task"] });
	assert.equal(gated("task", () => fallback), fallback, "neverFold keeps the tool's own rendering");
	assert.notEqual(gated("bash", () => fallback), fallback);
});

test("resolver: renders report their call in exactly once (idempotent membership)", () => {
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true });
	const mine = resolver("bash", () => undefined) as any;
	const ctx = {
		toolCallId: "c1",
		args: { command: "echo hi" },
		isPartial: true,
		expanded: false,
		isError: false,
		durationMs: undefined,
		invalidate: () => {},
	};
	mine.renderCall(ctx.args, th, ctx);
	mine.renderCall(ctx.args, th, ctx);
	assert.deepEqual(
		registry.membersOf("c1")!.map((m) => m.callId),
		["c1"],
		"a second render must not duplicate the member",
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Review fixes: click consumption + expand translation must not fight pi
// ─────────────────────────────────────────────────────────────────────────────

test("GroupLine: clicks on our lines are always consumed (pi's expand never fires by accident)", () => {
	const hits: string[] = [];
	const line = new GroupLine(
		() => ({ lines: ["header", "row"], hits: ["toggle-header", null] }),
		(hit) => hits.push(hit),
	);
	line.render(80);
	const onHeader = line.handleMouse({ type: "click", button: "left", y: 0 }) as any;
	assert.equal(onHeader.handled, true);
	assert.deepEqual(hits, ["toggle-header"]);
	// a click on a line without an action is still consumed — no pi toggle
	const onRow = line.handleMouse({ type: "click", button: "left", y: 1 }) as any;
	assert.equal(onRow.handled, true, "consumed");
	assert.deepEqual(hits, ["toggle-header"], "but no action fired");
	// outside our lines: not ours
	assert.equal(line.handleMouse({ type: "click", button: "left", y: 9 }), undefined);
	assert.equal(line.handleMouse({ type: "move", button: "left", y: 0 }), undefined);
});

test("resolver: a call rendering for the first time never collapses an open group", () => {
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true });
	const mine = resolver("bash", () => undefined) as any;
	const ctxFor = (id: string) => ({
		toolCallId: id,
		args: { command: "x" },
		isPartial: true,
		expanded: false,
		invalidate: () => {},
	});
	mine.renderCall({ command: "x" }, th, ctxFor("c1"));
	mine.renderCall({ command: "x" }, th, ctxFor("c2"));
	registry.toggleHeader("c1"); // user opens the group
	assert.equal(registry.planFor("c2")!.line, true, "group open");
	// a third call joins later and renders for the first time
	mine.renderCall({ command: "x" }, th, ctxFor("c3"));
	assert.equal(registry.planFor("c2")!.line, true, "the group must stay open");
	assert.equal(registry.planFor("c3")!.line, true);
});

test("resolver: ctrl+o style expanded flips are translated, per-call", () => {
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true });
	const mine = resolver("bash", () => undefined) as any;
	const ctxFor = (id: string, expanded: boolean) => ({
		toolCallId: id,
		args: { command: "x" },
		isPartial: true,
		expanded,
		invalidate: () => {},
	});
	mine.renderCall({ command: "x" }, th, ctxFor("c1", true)); // arrives expanded (ctrl+o on)
	assert.equal(registry.planFor("c1")!.full, true, "solo: expand goes straight to the full box");
	mine.renderCall({ command: "x" }, th, ctxFor("c1", false)); // ctrl+o off = collapse-all
	const folded = registry.planFor("c1")!;
	assert.equal(folded.line, false, "collapse-all now reaches the solo group (fix)");
	assert.equal(folded.header, "closed", "what remains is the summary line");
});

// ─────────────────────────────────────────────────────────────────────────────
// Sample-image alignment: five-state glyphs, token usage, └ gutter
// ─────────────────────────────────────────────────────────────────────────────

test("fmtRow: running glyph is ●, includes token usage ↑↓ when present", () => {
	assert.equal(
		fmtRow(
			{ status: "running", toolName: "bash", detail: "pnpm test", outcome: "running 2s", usage: { input: 1200, output: 169 }, frame: F0 },
			th,
		),
		"└ ⠋ bash pnpm test · running 2s · ↑1.2k ↓169",
	);
});

test("fmtRow: ok with usage shows ↑↓ before duration", () => {
	assert.equal(
		fmtRow(
			{ status: "ok", toolName: "read", detail: "src/app.ts", outcome: "120 lines", durationMs: 450, usage: { input: 500, output: 12000 } },
			th,
		),
		"└ ✓ read src/app.ts · 120 lines · ↑500 ↓12.0k · 450ms",
	);
});

test("fmtPinned: usage included", () => {
	assert.equal(
		fmtPinned(
			{ status: "ok", toolName: "edit", icon: "✏️", label: "~/x.ts", outcome: "+12/−3", durationMs: 300, usage: { input: 800, output: 40 } },
			th,
		),
		"✓ ✏️ edit ~/x.ts · +12/−3 · ↑800 ↓40 · 300ms",
	);
});

test("buildSummary: aggregates usage across members", () => {
	const members: ToolCallRecord[] = [
		{ callId: "1", toolName: "bash", status: "ok", durationMs: 100, usage: { input: 1000, output: 200 } },
		{ callId: "2", toolName: "read", status: "ok", durationMs: 50, usage: { input: 500, output: 100 } },
		{ callId: "3", toolName: "ls", status: "ok", durationMs: 10 }, // no usage
	];
	const s = buildSummary(members);
	assert.equal(s.usage!.input, 1500);
	assert.equal(s.usage!.output, 300);
});

test("buildSummary: no usage → usage field undefined", () => {
	const s = buildSummary([{ callId: "1", toolName: "bash", status: "ok" }]);
	assert.equal(s.usage, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Icon resolution (Task: icon table extension + 🤖 fallback)
// ─────────────────────────────────────────────────────────────────────────────

test("iconFor: exact match, mcp prefix, and fallback branches", async () => {
	const { iconFor } = await import("../src/styles.ts");
	assert.equal(iconFor("bash"), "⚡", "exact");
	assert.equal(iconFor("web_search"), "🌐");
	assert.equal(iconFor("workflow"), "🔀");
	assert.equal(iconFor("mcp__github__search"), "🔌", "mcp__ prefix");
	assert.equal(iconFor("mcpSomething"), "🔌", "bare mcp prefix");
	assert.equal(iconFor("totally_unknown_tool"), "🤖", "fallback");
});

test("iconFor: DIY overrides for mcp and the fallback key take effect", async () => {
	const { iconFor, mergeStyle } = await import("../src/styles.ts");
	const diy = mergeStyle({ icons: { "*": "❓", mcp: "🧩" } });
	assert.equal(iconFor("totally_unknown_tool", diy.icons), "❓");
	assert.equal(iconFor("mcp__x", diy.icons), "🧩");
	assert.equal(iconFor("bash", diy.icons), "⚡", "untouched keys keep defaults");
});

test("all default icons are exactly two cells (border/alignment guard)", async () => {
	const { TOOL_ICONS } = await import("../src/styles.ts");
	const { stringWidth } = await import("../src/width.ts");
	for (const [name, icon] of Object.entries(TOOL_ICONS)) {
		assert.equal(stringWidth(icon), 2, `icon for ${name} must be 2 cells wide`);
	}
});

test("panel rules: 🤖 title and a ZWJ/single-width label keep the right edge aligned", async () => {
	const { panelRuleDashes } = await import("../src/styles.ts");
	const { stringWidth } = await import("../src/width.ts");
	const inner = 60;
	const line = (label: string) => `┌─ ${label} ${"─".repeat(panelRuleDashes(label, inner))}┐`;
	const top = line("🤖 MISSION");
	const bottom = line("↑↓ select · Enter/Esc close");
	assert.equal(stringWidth(top), stringWidth(bottom), "top and bottom rules share one width");
	assert.ok(top.endsWith("┐") && bottom.endsWith("┐"));
	// the regression the old `.length` math would fail: a ZWJ label is 5 UTF-16
	// units but 2 cells — length-based dashes would come up 3 cells short
	const zwj = line("👨‍💻 X");
	assert.equal(stringWidth(zwj), stringWidth(bottom), "ZWJ label must not bend the box");
});

// ─────────────────────────────────────────────────────────────────────────────
// Running spinner (frame derived from the clock)
// ─────────────────────────────────────────────────────────────────────────────

test("spinnerFrame: clock-derived index, 180ms per frame, wraps both ways", async () => {
	const { spinnerFrame, SPINNER_FRAME_MS, DEFAULT_SPINNER } = await import("../src/styles.ts");
	assert.equal(SPINNER_FRAME_MS, 180);
	assert.equal(DEFAULT_SPINNER.length, 10);
	// fixed instants → deterministic frames (no flakiness)
	assert.equal(spinnerFrame(0), "⠋");
	assert.equal(spinnerFrame(179), "⠋", "still frame 0 just before the tick");
	assert.equal(spinnerFrame(180), "⠙");
	assert.equal(spinnerFrame(180 * 9), "⠏");
	assert.equal(spinnerFrame(180 * 10), "⠋", "wraps after 10 frames");
	assert.equal(spinnerFrame(180 * 137), DEFAULT_SPINNER[7], "137 % 10 === 7");
});

test("spinnerFrame: every frame is exactly one display cell (tmux/SSH safe)", async () => {
	const { stringWidth } = await import("../src/renderers.ts");
	for (const frame of DEFAULT_SPINNER) {
		assert.equal(stringWidth(frame), 1, `frame ${frame} must be single width`);
	}
});

test("spinnerFrame: custom frames honored; empty/garbage falls back to braille", async () => {
	const { spinnerFrame, DEFAULT_SPINNER, mergeStyle } = await import("../src/styles.ts");
	assert.equal(spinnerFrame(0, ["a", "b"]), "a");
	assert.equal(spinnerFrame(180, ["a", "b"]), "b");
	assert.equal(spinnerFrame(360, ["a", "b"]), "a");
	// mergeStyle: DIY spinner accepted, malformed ignored
	assert.deepEqual(mergeStyle({ spinner: ["+", "x"] }).spinner, ["+", "x"]);
	assert.deepEqual(mergeStyle({ spinner: [] }).spinner, DEFAULT_SPINNER, "empty list ignored");
	assert.deepEqual(mergeStyle({ spinner: [""] }).spinner, DEFAULT_SPINNER, "blank frame ignored");
	assert.deepEqual(mergeStyle(undefined).spinner, DEFAULT_SPINNER);
});

test("glossary: GLYPH.running is animated but its static fallback is not used by views", () => {
	// fmtPinned running uses the frame too (pinned cards while executing)
	assert.equal(
		fmtPinned({ status: "running", toolName: "write", icon: "📝", label: "x.ts", outcome: "running 1s", frame: F0 }, th),
		"⠋ 📝 write x.ts · running 1s",
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3a fix: pi passes isError/durationMs on CONTEXT (tool-execution.js:243),
// and pinned calls live outside membersOf — both must reach the rendered tail
// ─────────────────────────────────────────────────────────────────────────────

test("3a: renderResult reads isError + durationMs from context, not options", () => {
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true });
	const mine = resolver("bash", () => undefined) as any;
	const ctx = { toolCallId: "c1", args: { command: "pnpm test" }, isError: true, durationMs: 1800, invalidate: () => {} };
	// runtime shape: options = {expanded, isPartial} ONLY
	const component = mine.renderResult({ content: [{ type: "text", text: "exit code: 1" }] }, { expanded: false, isPartial: false }, th, ctx);
	const lines = component.render(120);
	assert.equal(registry.recordOf("c1")!.status, "error", "error state came from context");
	assert.equal(registry.recordOf("c1")!.durationMs, 1800, "duration came from context");
	const solo = registry.planFor("c1")!;
	assert.equal(solo.line, true, "autoRow: solo call renders its row");
	const out = lines.join("\n");
	assert.match(out, /✗/, "error glyph");
	// errors show the first line of the actual error output (never hide why it failed)
	assert.match(out, /exit code: 1/, "raw error line kept verbatim");
	assert.match(out, /1\.8s/, "duration in the tail");
});

test("3a: pinned (edit/write) card carries ↑↓ usage and duration", () => {
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true });
	const mine = resolver("edit", () => undefined) as any;
	registry.update("e1", { toolName: "edit", usage: { input: 800, output: 40 } }); // tool_result event
	const ctx = { toolCallId: "e1", args: { path: "/x.ts" }, isError: false, durationMs: 300, invalidate: () => {} };
	const component = mine.renderResult(
		{ content: [{ type: "text", text: "ok" }], details: { diff: "+added line\n+another\n-removed" } },
		{ expanded: false, isPartial: false },
		th,
		ctx,
	);
	const out = component.render(120).join("\n");
	assert.match(out, /↑800 ↓40/, "usage now reaches the pinned card");
	assert.match(out, /300ms/, "duration reaches the pinned card");
	assert.match(out, /\+2\/−1/, "diff stat counts +/- lines");
	assert.doesNotMatch(out, /1 lines/, "singular/plural grammar (was: '1 lines')");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bilingual description fallback when the model sent no reason
// ─────────────────────────────────────────────────────────────────────────────

test("desc: catalog fills the reason slot in zh/en; model reasoning wins", async () => {
	const { setLang } = await import("../src/strings.ts");
	setLang("zh");
	try {
		assert.equal(
			fmtRow({ status: "ok", toolName: "bash", desc: "运行命令", detail: "pnpm test", outcome: "done" }, th),
			"└ ✓ bash [运行命令] pnpm test · done",
		);
	} finally {
		setLang("en");
	}
	// reasoning present → catalog never doubles up (viewOf drops desc)
	assert.equal(
		fmtRow({ status: "ok", toolName: "bash", reasoning: "check failures", desc: "run command", detail: "pnpm test" }, th),
		"└ ✓ bash [check failures] pnpm test",
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Display-width clipping: emoji/CJK are double-width; UTF-16 counting broke rows
// ─────────────────────────────────────────────────────────────────────────────

test("stringWidth: ascii=1, CJK=2, emoji=2, VS16 widens, marks add nothing", () => {
	assert.equal(stringWidth("abc"), 3);
	assert.equal(stringWidth("中文"), 4);
	assert.equal(stringWidth("⚡"), 2);
	assert.equal(stringWidth("📖×2"), 4);
	assert.equal(stringWidth("✏️"), 2, "U+270F is narrow until VS16 flips it");
	assert.equal(stringWidth("✓✗●▸└"), 5, "box/dingbat glyphs stay single-width");
	assert.equal(stringWidth("👨‍💻"), 2, "ZWJ sequence counts as one emoji");
});

test("GroupLine.render: clipping lands on a cell boundary, never mid-emoji", () => {
	const line = new GroupLine(() => ({ lines: ["⚡⚡⚡".padEnd(0) + "abcdefgh"], hits: [null] }), () => {});
	const out = line.render(6)[0];
	assert.equal(stringWidth(out.replace("…", "")), 6);
	assert.ok(out.endsWith("…"));
	// an emoji that would straddle the boundary is dropped, not halved
	const line2 = new GroupLine(() => ({ lines: ["abc⚡"], hits: [null] }), () => {});
	const out2 = line2.render(4)[0];
	assert.equal(out2, "abc…", "⚡ (2 cells) does not fit in 4th cell");
});

// ─────────────────────────────────────────────────────────────────────────────
// outcome grammar: diff stat first, exit code, localized line counts
// ─────────────────────────────────────────────────────────────────────────────

test("outcomeOf: diff stat, exit code, line counts (singular)", () => {
	assert.equal(outcomeOf({ content: [], details: { diff: "+a\n+b\n-c" } }, false), "+2/−1");
	assert.equal(outcomeOf({ content: [{ type: "text", text: "exit code: 0" }] }, false), "done");
	assert.equal(outcomeOf({ content: [{ type: "text", text: "hello\nworld" }] }, false), "2 lines");
	assert.equal(outcomeOf({ content: [{ type: "text", text: "single" }] }, false), "1 line", "was: '1 lines'");
	assert.equal(outcomeOf({ content: [] }, false), "ok");
});

test("shortenPath: home dir collapses to ~, odd values pass through", async () => {
	const { shortenPath, detailOf } = await import("../src/renderers.ts");
	const { homedir } = await import("os");
	assert.equal(shortenPath(`${homedir()}/x/y.ts`), "~/x/y.ts");
	assert.equal(shortenPath("/etc/hosts"), "/etc/hosts", "outside home stays absolute");
	assert.equal(shortenPath("relative/path"), "relative/path");
	assert.equal(detailOf("edit", { path: `${homedir()}/README.zh-CN.md` }), "~/README.zh-CN.md");
});

// ─────────────────────────────────────────────────────────────────────────────
// Pinned (edit/write) scrollable box — fixed viewport + wheel scroll
// ─────────────────────────────────────────────────────────────────────────────

/** Render a pinned edit result with an N-line diff through a fresh resolver. */
function pinnedBox(lineCount: number, bodyHeight = 5, callId = "e1") {
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true, bodyHeight: () => bodyHeight });
	const mine = resolver("edit", () => undefined) as any;
	const diff = Array.from({ length: lineCount }, (_, i) => `+line${i + 1}`).join("\n");
	const ctx = { toolCallId: callId, args: { path: "/x.ts" }, isError: false, durationMs: 300, invalidate: () => {} };
	const component = mine.renderResult(
		{ content: [{ type: "text", text: "ok" }], details: { diff } },
		{ expanded: false, isPartial: false },
		th,
		ctx,
	);
	return component;
}

test("003 header: total line count in the tail (zh/en)", () => {
	assert.equal(
		fmtPinned({ status: "ok", toolName: "edit", label: "~/x.ts", totalLines: 142 }, th),
		"✓ edit ~/x.ts · 142 lines",
	);
	assert.equal(
		fmtPinned({ status: "ok", toolName: "edit", label: "~/x.ts", totalLines: 3, durationMs: 300 }, th),
		"✓ edit ~/x.ts · 300ms · 3 lines",
	);
	assert.equal(fmtPinned({ status: "ok", toolName: "edit", totalLines: 1 }, th), "✓ edit", "single line: no count");
	assert.equal(fmtPinned({ status: "ok", toolName: "edit", totalLines: 0 }, th), "✓ edit", "empty: no count");
});

test("003 short body: natural height, no scroll indicators (acceptance 1)", () => {
	const component = pinnedBox(3, 5, "t003-short"); // 3 lines, viewport 5
	const lines = component.render(120);
	assert.equal(lines.length, 4, "header + 3 body lines, nothing else");
	assert.doesNotMatch(lines.join("\n"), /▲|▼/, "no indicators for short content");
	// wheel must fall through to pi's global scroll
	assert.equal(component.handleMouse({ type: "wheel", button: 64, y: 1, wheelDelta: 3 }), undefined);
});

test("003 long body: fixed viewport + below indicator + header count (acceptance 2)", () => {
	const component = pinnedBox(20, 5, "t003-long");
	const lines = component.render(120);
	assert.equal(lines.length, 7, "header + 5 viewport lines + below indicator");
	assert.match(lines[0], /20 lines/, "header carries total line count");
	assert.match(lines[6], /▼ 15 below/, "below indicator (last line) counts hidden lines");
	assert.doesNotMatch(lines.join("\n"), /▲/, "nothing above at top position");
	assert.match(lines[1], /line1/, "viewport starts at the top");
	assert.doesNotMatch(lines.join("\n"), /line6/, "line 6 stays outside the 5-line viewport");
});

test("003 wheel: consumes and scrolls the viewport", () => {
	const component = pinnedBox(20, 5, "t003-wheel");
	const first = component.render(120).join("\n");
	assert.match(first, /line1/);

	const result = component.handleMouse({ type: "wheel", button: 64, y: 2, wheelDelta: 3 }) as any;
	assert.equal(result.handled, true, "scrollable box consumes the wheel");
	assert.equal(result.render, true);

	const after = component.render(120).join("\n");
	assert.match(after, /▲ 3 above/, "above indicator appears");
	assert.match(after, /▼ 12 below/, "below count shrinks");
	assert.match(after, /line4/, "viewport moved by 3");
	assert.doesNotMatch(after, /line1\b/, "line 1 scrolled out");
});

test("003 wheel: clamps at both boundaries, still consumes (contain semantics)", () => {
	const component = pinnedBox(20, 5, "t003-clamp");
	// scroll far past the end → clamp at max (20-5=15)
	component.handleMouse({ type: "wheel", button: 64, y: 2, wheelDelta: 100 });
	const bottom = component.render(120).join("\n");
	assert.match(bottom, /▲ 15 above/);
	assert.doesNotMatch(bottom, /▼/, "no hidden lines at the bottom");
	assert.match(bottom, /line16/, "clamped at last full viewport");

	// at the boundary: still consumes (render:false) so the transcript never jumps
	const atEdge = component.handleMouse({ type: "wheel", button: 64, y: 2, wheelDelta: 5 }) as any;
	assert.equal(atEdge.handled, true, "boundary still consumes (contain, acceptance 4)");
	assert.equal(atEdge.render, false, "nothing moved → no repaint");

	// scroll far up → clamp at 0
	component.handleMouse({ type: "wheel", button: 64, y: 2, wheelDelta: -100 });
	const top = component.render(120).join("\n");
	assert.match(top, /line1/, "clamped back at the top");
	assert.doesNotMatch(top, /▲/, "no above indicator at top");
});

test("003 wheel: negative delta scrolls up", () => {
	const component = pinnedBox(20, 5, "t003-up");
	component.handleMouse({ type: "wheel", button: 64, y: 2, wheelDelta: 10 });
	assert.match(component.render(120).join("\n"), /▲ 10 above/);
	component.handleMouse({ type: "wheel", button: 65, y: 2, wheelDelta: -4 });
	const up = component.render(120).join("\n");
	assert.match(up, /▲ 6 above/, "scrolled back up by 4");
	assert.match(up, /line7/, "viewport moved up");
});

test("003 shrink: content below viewport clears stale scroll state", () => {
	const component = pinnedBox(20, 5, "t003-shrink");
	component.handleMouse({ type: "wheel", button: 64, y: 2, wheelDelta: 8 });
	assert.match(component.render(120).join("\n"), /▲ 8 above/);

	// same callId re-renders with a SHORT result (stale scroll must not apply)
	const registry = new GroupRegistry();
	const resolver = createToolResolver({ registry, enabled: () => true, bodyHeight: () => 5 });
	const mine = resolver("edit", () => undefined) as any;
	const ctx = { toolCallId: "t003-shrink", args: { path: "/x.ts" }, isError: false, durationMs: 1, invalidate: () => {} };
	const comp2 = mine.renderResult(
		{ content: [{ type: "text", text: "ok" }], details: { diff: "+only\n-two" } },
		{ expanded: false, isPartial: false },
		th,
		ctx,
	);
	const out = comp2.render(120).join("\n");
	assert.match(out, /\+only/, "fresh short content renders fully from the top");
	assert.doesNotMatch(out, /▲|▼/, "no indicators once content fits");
});

test("003 dispose: session_shutdown clears pinned scroll state", async () => {
	const { disposeAllRenderers } = await import("../src/renderers.ts");
	const component = pinnedBox(20, 5, "t003-dispose");
	component.handleMouse({ type: "wheel", button: 64, y: 2, wheelDelta: 6 });
	assert.match(component.render(120).join("\n"), /▲ 6 above/);

	disposeAllRenderers();
	// the map is cleared — a fresh render of the same call starts at the top
	assert.match(component.render(120).join("\n"), /line1/, "scroll state reset after dispose");
	assert.doesNotMatch(component.render(120).join("\n"), /▲/, "no stale above indicator");
});

test("003 bodyHeight: configurable viewport (acceptance 2)", () => {
	const tall = pinnedBox(30, 12, "t003-tall");
	const lines = tall.render(120);
	assert.equal(lines.length, 14, "header + 12 viewport lines + below indicator");
	assert.match(lines[13], /▼ 18 below/);
});
