/**
 * Task 2 tests — pure line formatting + resolver-chain contract.
 * Written first (red), then implemented by src/renderers.ts (green).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GroupLine, createToolResolver, fmtDuration, fmtPinned, fmtRow, fmtSummaryLine, outcomeOf, stringWidth, type ThemeLike } from "../src/renderers.ts";
import { GroupRegistry, buildSummary, type GroupSummary, type ToolCallRecord } from "../src/groups.ts";

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

test("fmtSummaryLine: marker, count, icon breakdown, failed, running, duration", () => {
	assert.equal(fmtSummaryLine(summary, 0, th), "▸ 5 calls · ⚡×3 📖×2 · ✗ 2 failed · ● 1 running · 1.2s");
	assert.equal(fmtSummaryLine(summary, 1, th), "▾ 5 calls · ⚡×3 📖×2 · ✗ 2 failed · ● 1 running · 1.2s");
});

test("fmtSummaryLine: unknown tools keep their name in the breakdown", () => {
	const s: GroupSummary = { count: 2, breakdown: [{ name: "mcp__docs__search", count: 2 }], failed: 0, running: 0, durationMs: 0 };
	assert.equal(fmtSummaryLine(s, 0, th), "▸ 2 calls · mcp__docs__search×2");
});

test("fmtSummaryLine: zh words (setLang) and DIY style glyphs", async () => {
	const { setLang } = await import("../src/strings.ts");
	const { mergeStyle } = await import("../src/styles.ts");
	setLang("zh");
	try {
		assert.equal(fmtSummaryLine(summary, 0, th), "▸ 5 次调用 · ⚡×3 📖×2 · ✗ 2 次失败 · ● 1 个运行中 · 1.2s");
	} finally {
		setLang("en");
	}
	const diy = mergeStyle({ marker: "❯", openMarker: "⌄", rowGutter: "┆", sep: "|", icons: { bash: "BASH" } });
	assert.equal(fmtSummaryLine(summary, 0, th, diy), "❯ 5 calls | BASH×3 📖×2 | ✗ 2 failed | ● 1 running | 1.2s");
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

test("fmtRow: running glyph and live outcome", () => {
	assert.equal(
		fmtRow({ status: "running", toolName: "bash", detail: "pnpm test", outcome: "running 2s" }, th),
		"└ ● bash pnpm test · running 2s",
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
	assert.equal(folded.line, false, "collapse-all now reaches the solo group (audit fix)");
	assert.equal(folded.header, "closed", "what remains is the summary line");
});

// ─────────────────────────────────────────────────────────────────────────────
// Sample-image alignment: five-state glyphs, token usage, └ gutter
// ─────────────────────────────────────────────────────────────────────────────

test("fmtRow: running glyph is ●, includes token usage ↑↓ when present", () => {
	assert.equal(
		fmtRow(
			{ status: "running", toolName: "bash", detail: "pnpm test", outcome: "running 2s", usage: { input: 1200, output: 169 } },
			th,
		),
		"└ ● bash pnpm test · running 2s · ↑1.2k ↓169",
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
// Requirement 1: bilingual description fallback when the model sent no reason
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
