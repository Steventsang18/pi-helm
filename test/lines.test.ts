/**
 * Task 2 tests — pure line formatting + resolver-chain contract.
 * Written first (red), then implemented by src/renderers.ts (green).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GroupLine, createToolResolver, fmtDuration, fmtPinned, fmtRow, fmtSummaryLine, type ThemeLike } from "../src/renderers.ts";
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

test("fmtSummaryLine: marker, count, breakdown, failed, running, duration", () => {
	assert.equal(fmtSummaryLine(summary, 0, th), "▸ 5 calls · bash×3 read×2 · 2 failed · ● 1 running · 1.2s");
	assert.equal(fmtSummaryLine(summary, 1, th), "▾ 5 calls · bash×3 read×2 · 2 failed · ● 1 running · 1.2s");
});

test("fmtSummaryLine: quiet group omits failed/running/duration", () => {
	const quiet: GroupSummary = { count: 1, breakdown: [{ name: "read", count: 1 }], failed: 0, running: 0, durationMs: 0 };
	assert.equal(fmtSummaryLine(quiet, 0, th), "▸ 1 call · read×1");
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
	assert.equal(registry.planFor("c1")!.header, "open", "group opens");
	mine.renderCall({ command: "x" }, th, ctxFor("c1", false)); // ctrl+o off
	assert.equal(registry.planFor("c1")!.header, "closed", "collapse-all lands");
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
