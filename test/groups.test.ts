/**
 * Task 1 tests — pure state machine, no pi dependency.
 * Written first (red), then implemented by src/groups.ts (green).
 *
 * Semantics absorbed from pi-tidy's grouping model (boundary/carrier/plain,
 * anti-flicker delay, sticky failure count), expression is our own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	GroupRegistry,
	RUNNING_ROW_DELAY_MS,
	buildSummary,
	classifyAssistant,
	rebuildFromEntries,
	viewPlan,
	type ToolCallRecord,
} from "../src/groups.ts";

// ─────────────────────────────────────────────────────────────────────────────
// classifyAssistant
// ─────────────────────────────────────────────────────────────────────────────

test("classify: visible text → boundary (text alone or text + toolCall)", () => {
	assert.equal(classifyAssistant({ content: [{ type: "text", text: "hi" }] }), "boundary");
	assert.equal(
		classifyAssistant({
			content: [
				{ type: "text", text: "running it" },
				{ type: "toolCall", id: "c1" },
			],
		}),
		"boundary",
	);
});

test("classify: thinking + toolCall only → carrier", () => {
	assert.equal(
		classifyAssistant({
			content: [
				{ type: "thinking", thinking: "let me check" },
				{ type: "toolCall", id: "c1" },
			],
		}),
		"carrier",
	);
	// whitespace-only text is not visible text
	assert.equal(
		classifyAssistant({
			content: [
				{ type: "text", text: "   \n" },
				{ type: "toolCall", id: "c1" },
			],
		}),
		"carrier",
	);
});

test("classify: stopReason=length → plain (truncation notice never folds away)", () => {
	assert.equal(
		classifyAssistant({
			content: [{ type: "toolCall", id: "c1" }],
			stopReason: "length",
		}),
		"plain",
	);
});

test("classify: thinking only (no toolCall) → plain", () => {
	assert.equal(classifyAssistant({ content: [{ type: "thinking", thinking: "…" }] }), "plain");
});

test("classify: malformed shape → boundary (never hide)", () => {
	assert.equal(classifyAssistant(undefined), "boundary");
	assert.equal(classifyAssistant({}), "boundary");
	assert.equal(classifyAssistant({ content: "not-an-array" }), "boundary");
	assert.equal(classifyAssistant({ content: 42, stopReason: "length" }), "boundary");
});

// ─────────────────────────────────────────────────────────────────────────────
// GroupRegistry — membership
// ─────────────────────────────────────────────────────────────────────────────

test("registry: boundary opens a new group", () => {
	const r = new GroupRegistry();
	r.report({ callId: "a", toolName: "bash", status: "ok" });
	r.noteBoundary();
	r.report({ callId: "b", toolName: "read", status: "ok" });
	assert.deepEqual(
		r.membersOf("a")!.map((m) => m.callId),
		["a"],
	);
	assert.deepEqual(
		r.membersOf("b")!.map((m) => m.callId),
		["b"],
	);
	assert.notEqual(r.membersOf("a"), r.membersOf("b"));
});

test("registry: carrier and tools join the current group", () => {
	const r = new GroupRegistry();
	r.report({ callId: "a", toolName: "bash", status: "ok" });
	r.noteCarrier(); // thinking+tool step must NOT split the group
	r.report({ callId: "b", toolName: "read", status: "ok" });
	assert.deepEqual(
		r.membersOf("b")!.map((m) => m.callId),
		["a", "b"],
	);
});

test("registry: report is idempotent — a call reports in once", () => {
	const r = new GroupRegistry();
	assert.equal(r.report({ callId: "a", toolName: "bash", status: "running" }), true);
	assert.equal(r.report({ callId: "a", toolName: "bash", status: "running" }), false);
	assert.equal(r.membersOf("a")!.length, 1);
	// update() merges instead of duplicating
	assert.equal(r.update("a", { status: "error", durationMs: 5 }), true);
	const m = r.membersOf("a")![0];
	assert.equal(m.status, "error");
	assert.equal(m.durationMs, 5);
	assert.equal(r.membersOf("a")!.length, 1);
});

test("registry: pinned tools (edit/write) never fold and cut the group", () => {
	const r = new GroupRegistry();
	r.report({ callId: "a", toolName: "bash", status: "ok" });
	r.report({ callId: "e", toolName: "edit", status: "ok", durationMs: 3 });
	r.report({ callId: "b", toolName: "bash", status: "ok" });

	// pinned call is not a group member…
	assert.equal(r.membersOf("e"), undefined);
	const pinned = r.planFor("e")!;
	assert.equal(pinned.full, true);
	assert.equal(pinned.line, false);
	assert.equal(pinned.header, null);
	// …and cuts the group: a and b sit in different groups
	assert.notEqual(r.membersOf("a"), r.membersOf("b"));
	assert.deepEqual(
		r.membersOf("b")!.map((m) => m.callId),
		["b"],
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSummary
// ─────────────────────────────────────────────────────────────────────────────

test("summary: counts, freq-desc/alpha-tie breakdown, failed, running, duration sum", () => {
	const members: ToolCallRecord[] = [
		{ callId: "1", toolName: "bash", status: "error", durationMs: 100 },
		{ callId: "2", toolName: "bash", status: "ok", durationMs: 200 },
		{ callId: "3", toolName: "bash", status: "ok" }, // no duration yet → 0
		{ callId: "4", toolName: "zsh", status: "ok", durationMs: 50 },
		{ callId: "5", toolName: "read", status: "running", startedAt: 0 },
	];
	const s = buildSummary(members);
	assert.equal(s.count, 5);
	// bash×3 first; read/zsh tie at 1 → alphabetical
	assert.deepEqual(s.breakdown, [
		{ name: "bash", count: 3 },
		{ name: "read", count: 1 },
		{ name: "zsh", count: 1 },
	]);
	assert.equal(s.failed, 1);
	assert.equal(s.running, 1);
	assert.equal(s.durationMs, 350);
});

test("summary: empty group is well-formed", () => {
	const s = buildSummary([]);
	assert.equal(s.count, 0);
	assert.deepEqual(s.breakdown, []);
	assert.equal(s.failed, 0);
	assert.equal(s.running, 0);
	assert.equal(s.durationMs, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// viewPlan (pure)
// ─────────────────────────────────────────────────────────────────────────────

test("viewPlan level0: only the first member carries the summary row; others hidden", () => {
	const first = viewPlan({ isFirst: true, level: 0 });
	assert.equal(first.header, "closed");
	assert.equal(first.line, false);
	assert.equal(first.full, false);
	const other = viewPlan({ isFirst: false, level: 0 });
	assert.equal(other.header, null);
	assert.equal(other.line, false);
	assert.equal(other.full, false);
});

test("viewPlan level1: one row per member, first carries the open header", () => {
	const first = viewPlan({ isFirst: true, level: 1 });
	assert.equal(first.header, "open");
	assert.equal(first.line, true);
	assert.equal(first.gutter, true);
	const other = viewPlan({ isFirst: false, level: 1 });
	assert.equal(other.header, null);
	assert.equal(other.line, true);
	assert.equal(other.full, false);
	assert.equal(other.gutter, true);
});

test("viewPlan: PINNED (edit/write) is always the full box", () => {
	const p = viewPlan({ pinned: true, level: 0 });
	assert.equal(p.header, null);
	assert.equal(p.line, false);
	assert.equal(p.full, true);
	assert.equal(p.gutter, false);
});

test("viewPlan: running <1s is fresh (hidden with revealIn); ≥1s surfaces one row", () => {
	const fresh = viewPlan({ level: 0, runningAgeMs: 400 });
	assert.equal(fresh.line, false);
	assert.equal(fresh.full, false);
	assert.equal(fresh.revealIn, RUNNING_ROW_DELAY_MS - 400);
	const stale = viewPlan({ level: 0, runningAgeMs: RUNNING_ROW_DELAY_MS + 500 });
	assert.equal(stale.line, true);
	assert.equal(stale.full, false);
	assert.equal(stale.gutter, true);
	const idle = viewPlan({ level: 0 });
	assert.equal(idle.line, false);
	assert.equal(idle.revealIn, undefined);
});

test("viewPlan level2: an expanded member shows the full box", () => {
	const v = viewPlan({ level: 1, expanded: true });
	assert.equal(v.line, false);
	assert.equal(v.full, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Expand semantics (registry state machine)
// ─────────────────────────────────────────────────────────────────────────────

test("expand: header click toggles 0↔1; closing clears expanded members", () => {
	const r = new GroupRegistry({ now: () => 10_000 });
	r.report({ callId: "a", toolName: "bash", status: "ok", durationMs: 1 });
	r.report({ callId: "b", toolName: "read", status: "ok", durationMs: 1 });

	assert.equal(r.planFor("a")!.header, "closed");
	r.toggleHeader("a"); // → level 1
	assert.equal(r.planFor("a")!.header, "open");
	assert.equal(r.planFor("b")!.line, true);

	r.rowClick("a"); // one member goes level2
	assert.equal(r.planFor("a")!.full, true);
	r.toggleHeader("a"); // → back to level 0
	assert.equal(r.planFor("a")!.header, "closed");
	assert.equal(r.planFor("a")!.full, false, "closing the group folds full boxes back");
	assert.equal(r.planFor("b")!.line, false);
});

test("expand: row click opens level2 for that member only", () => {
	const r = new GroupRegistry();
	r.report({ callId: "a", toolName: "bash", status: "ok", durationMs: 1 });
	r.report({ callId: "b", toolName: "read", status: "ok", durationMs: 1 });
	r.toggleHeader("a");
	r.rowClick("b");
	assert.equal(r.planFor("b")!.full, true);
	assert.equal(r.planFor("b")!.line, false);
	assert.equal(r.planFor("a")!.line, true);
	assert.equal(r.planFor("a")!.full, false);
});

test("expand: ctrl+o expanded flag is translated into levels", () => {
	const r = new GroupRegistry();
	r.report({ callId: "a", toolName: "bash", status: "ok", durationMs: 1 });
	r.report({ callId: "b", toolName: "read", status: "ok", durationMs: 1 });

	// expand (ctrl+o expand-all / pi's own expand): opens the group
	r.noteSetExpanded("a", true, false);
	assert.equal(r.planFor("a")!.header, "open");
	assert.equal(r.planFor("b")!.line, true);

	// collapse from a pointer click on one full box: that box only
	r.noteSetExpanded("a", false, true);
	assert.equal(r.planFor("a")!.line, true);
	assert.equal(r.planFor("b")!.line, true, "level stays open");

	// collapse from ctrl+o (not from a pointer): the whole group back to summary
	r.noteSetExpanded("b", false, false);
	assert.equal(r.planFor("a")!.header, "closed");
	assert.equal(r.planFor("b")!.line, false);
});

test("registry.planFor: unknown call → undefined; solo running row is live from frame one", () => {
	const r = new GroupRegistry({ now: () => 10_000 });
	assert.equal(r.planFor("nope"), undefined);
	r.report({ callId: "a", toolName: "bash", status: "running", startedAt: 9_500 });
	const plan = r.planFor("a")!;
	// A (autoRow): one call = the row *is* the view — live clock from frame
	// one, no summary header, no anti-flicker delay (nothing above to pop from)
	assert.equal(plan.line, true);
	assert.equal(plan.revealIn, undefined);
	assert.equal(plan.header, null);
	assert.equal(plan.full, false);
});

test("registry.planFor: a grouped running row still earns its keep after 1s (anti-flicker holds)", () => {
	const r = new GroupRegistry({ now: () => 10_000 });
	r.report({ callId: "a", toolName: "bash", status: "ok" });
	r.report({ callId: "b", toolName: "read", status: "running", startedAt: 9_500 });
	const plan = r.planFor("b")!;
	assert.equal(plan.line, false, "two members: not solo, fresh running row stays hidden");
	assert.equal(plan.revealIn, RUNNING_ROW_DELAY_MS - 500);
	// the first member still carries the summary — never a blank frame
	assert.equal(r.planFor("a")!.header, "closed");
});

// ─────────────────────────────────────────────────────────────────────────────
// rebuildFromEntries — session restore (Task 4)
// ─────────────────────────────────────────────────────────────────────────────

/** Shaped like pi's SessionMessageEntry / AssistantMessage / ToolResultMessage. */
const msg = (message: unknown) => ({ type: "message", message });

test("rebuild: assistant classify, tool results join and settle, groups survive restore", () => {
	const r = new GroupRegistry();
	rebuildFromEntries(r, [
		msg({
			role: "assistant",
			content: [
				{ type: "text", text: "Let me look around" },
				{ type: "toolCall", id: "c1", name: "bash", arguments: {} },
			],
			stopReason: "toolUse",
		}),
		msg({ role: "toolResult", toolCallId: "c1", toolName: "bash", isError: false, durationMs: 120, content: [] }),
		msg({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "now read the two files" },
				{ type: "toolCall", id: "c2", name: "read", arguments: {} },
				{ type: "toolCall", id: "c3", name: "read", arguments: {} },
			],
			stopReason: "toolUse",
		}),
		msg({ role: "toolResult", toolCallId: "c2", toolName: "read", isError: false, durationMs: 30, content: [] }),
		msg({ role: "toolResult", toolCallId: "c3", toolName: "read", isError: true, content: [] }),
		msg({ role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop" }),
	]);

	// carrier step folded into the boundary's group: all three calls together
	assert.deepEqual(
		(r.membersOf("c1") ?? []).map((m) => m.callId),
		["c1", "c2", "c3"],
	);
	const s = r.summary("c2")!;
	assert.equal(s.count, 3);
	assert.equal(s.failed, 1);
	assert.equal(s.durationMs, 150);
	// tool results settle their call
	assert.equal(r.membersOf("c1")![0].status, "ok");
	assert.equal(r.membersOf("c2")![2].status, "error");
});

test("rebuild: pinned tools cut the group; a new boundary starts fresh", () => {
	const r = new GroupRegistry();
	rebuildFromEntries(r, [
		msg({ role: "assistant", content: [{ type: "toolCall", id: "a", name: "bash", arguments: {} }], stopReason: "toolUse" }),
		msg({ role: "toolResult", toolCallId: "a", toolName: "bash", isError: false, content: [] }),
		msg({ role: "assistant", content: [{ type: "toolCall", id: "e", name: "edit", arguments: {} }], stopReason: "toolUse" }),
		msg({ role: "toolResult", toolCallId: "e", toolName: "edit", isError: false, content: [] }),
		msg({ role: "assistant", content: [{ type: "toolCall", id: "b", name: "bash", arguments: {} }], stopReason: "toolUse" }),
		msg({ role: "toolResult", toolCallId: "b", toolName: "bash", isError: false, content: [] }),
	]);
	assert.equal(r.isPinned("e"), true);
	assert.notEqual(r.membersOf("a"), r.membersOf("b"));
	assert.deepEqual(
		(r.membersOf("b") ?? []).map((m) => m.callId),
		["b"],
	);
});

test("rebuild: a result whose call never appeared still joins; re-running never duplicates", () => {
	const r = new GroupRegistry();
	const entries = [
		msg({ role: "toolResult", toolCallId: "x", toolName: "grep", isError: false, durationMs: 5, content: [] }),
		msg({ role: "assistant", content: [{ type: "toolCall", id: "y", name: "bash", arguments: {} }], stopReason: "toolUse" }),
		msg({ role: "toolResult", toolCallId: "y", toolName: "bash", isError: false, content: [] }),
	];
	rebuildFromEntries(r, entries);
	rebuildFromEntries(r, entries);
	const ids = (r.membersOf("x") ?? []).map((m) => m.callId);
	assert.deepEqual(ids, ["x", "y"]);
	assert.equal(ids.filter((id) => id === "x").length, 1, "a second rebuild must not duplicate the call");
	assert.equal(ids.filter((id) => id === "y").length, 1, "a second rebuild must not duplicate the call");
});

test("rebuild: malformed entries are ignored, never throw", () => {
	const r = new GroupRegistry();
	rebuildFromEntries(r, [
		{ type: "usage" },
		{ type: "message" },
		{ type: "message", message: null },
		{ type: "message", message: { role: "assistant", content: "not-an-array" } },
		msg({ role: "toolResult", toolCallId: "z", toolName: "bash", isError: false, content: [] }),
	]);
	assert.deepEqual(
		(r.membersOf("z") ?? []).map((m) => m.callId),
		["z"],
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Boundary timing (review fix): a call may report BEFORE its message's
// message_end. The boundary must move those calls into the group it opens.
// ─────────────────────────────────────────────────────────────────────────────

test("boundary: calls reported before message_end move into the group the boundary opens", () => {
	const r = new GroupRegistry();
	// A1 (boundary) + c1: the call renders while A1 streams, message_end follows
	let mark = r.mark();
	r.report({ callId: "c1", toolName: "bash", status: "running" });
	r.noteBoundary(mark);
	// A2 (boundary) + c2, then A3 (carrier) + c3, then A4 (boundary) + c4
	mark = r.mark();
	r.report({ callId: "c2", toolName: "bash", status: "running" });
	r.noteBoundary(mark); // A2's message_end
	r.report({ callId: "c3", toolName: "read", status: "running" }); // A3 carrier: no boundary
	mark = r.mark();
	r.report({ callId: "c4", toolName: "read", status: "running" });
	r.noteBoundary(mark); // A4's message_end pulls c4 out of the group

	// groups: [c1] | [c2, c3] | [c4]
	assert.deepEqual((r.membersOf("c1") ?? []).map((m) => m.callId), ["c1"]);
	assert.deepEqual((r.membersOf("c2") ?? []).map((m) => m.callId), ["c2", "c3"]);
	assert.deepEqual((r.membersOf("c4") ?? []).map((m) => m.callId), ["c4"]);
	assert.equal(r.membersOf("c2"), r.membersOf("c3"), "carrier folds into the same group");
	assert.notEqual(r.membersOf("c1"), r.membersOf("c2"), "boundaries separate groups");
	assert.notEqual(r.membersOf("c3"), r.membersOf("c4"), "boundaries separate groups");
});

test("boundary: carrier calls stay with the previous call of their group", () => {
	const r = new GroupRegistry();
	let mark = r.mark();
	r.report({ callId: "t1", toolName: "bash", status: "running" });
	r.noteBoundary(mark); // boundary ends → t1 sealed in its group
	// next boundary's message issues two calls (both render before its end)
	mark = r.mark();
	r.report({ callId: "t2", toolName: "bash", status: "running" });
	r.report({ callId: "t3", toolName: "bash", status: "running" });
	r.noteBoundary(mark);
	assert.deepEqual((r.membersOf("t2") ?? []).map((m) => m.callId), ["t2", "t3"]);
	assert.notEqual(r.membersOf("t1"), r.membersOf("t2"));
});

// ── usage accumulation (the turnUsage-fix regression, 2026-10-28) ────────────
test("usage: attachUsage folds accumulated assistant usage into a summary", () => {
	const r = new GroupRegistry();
	r.report({ callId: "c1", toolName: "bash", status: "ok" });
	r.noteUsage(1200, 340);
	const s = r.attachUsage(buildSummary(r.membersOf("c1") ?? []));
	assert.deepEqual(s.usage, { input: 1200, output: 340 });
});

test("usage: no accumulation → summary keeps its own (member-derived) usage", () => {
	const r = new GroupRegistry();
	r.report({ callId: "c1", toolName: "bash", status: "ok", usage: { input: 10, output: 5 } });
	const s = r.attachUsage(buildSummary(r.membersOf("c1") ?? []));
	assert.deepEqual(s.usage, { input: 10, output: 5 });
	const r2 = new GroupRegistry();
	r2.report({ callId: "c1", toolName: "bash", status: "ok", usage: { input: 10, output: 5 } });
	r2.noteUsage(100, 50);
	const s2 = r2.attachUsage(buildSummary(r2.membersOf("c1") ?? []));
	// accumulated assistant usage wins when present (it is the turn total)
	assert.deepEqual(s2.usage, { input: 100, output: 50 });
});

test("usage: registry.summary() is the display path and carries accumulated usage", () => {
	const r = new GroupRegistry();
	r.report({ callId: "c1", toolName: "grep", status: "ok" });
	r.noteUsage(777, 88);
	const s = r.summary("c1");
	assert.ok(s, "summary(callId) resolves for a grouped call");
	assert.deepEqual(s!.usage, { input: 777, output: 88 });
});

test("usage: resetUsage clears only the turn total; group keeps its own stamp", () => {
	const r = new GroupRegistry();
	r.report({ callId: "c1", toolName: "bash", status: "ok" });
	r.noteUsage(1000, 200);
	// turn total is reset for the next turn...
	r.resetUsage();
	const turn = r.attachUsage(buildSummary(r.membersOf("c1") ?? []));
	assert.equal(turn.usage, undefined, "turn total cleared");
	// ...but the group's own stamp survives (it is display state, not turn state)
	const s = r.summary("c1");
	assert.deepEqual(s!.usage, { input: 1000, output: 200 });
});

test("usage: each group keeps its own share, not the live total (replay regression)", () => {
	const r = new GroupRegistry();
	// group A: one call, then two assistant messages land on it
	r.report({ callId: "a1", toolName: "bash", status: "ok" });
	r.noteUsage(100, 10);
	r.noteUsage(200, 20);
	r.seal(); // boundary seals A, opens B
	// group B: one call, one assistant message
	r.report({ callId: "b1", toolName: "grep", status: "ok" });
	r.noteUsage(900, 90);
	// A must show ITS share (300/30), not B's total (1200/120)
	assert.deepEqual(r.summary("a1")!.usage, { input: 300, output: 30 });
	// B shows its own share (900/90)
	assert.deepEqual(r.summary("b1")!.usage, { input: 900, output: 90 });
	// turn total spans both groups
	const turn = r.attachUsage(buildSummary([...(r.membersOf("a1") ?? []), ...(r.membersOf("b1") ?? [])]));
	assert.deepEqual(turn.usage, { input: 1200, output: 120 });
});

test("usage: a sealed group is stable while later usage flows to the next group", () => {
	const r = new GroupRegistry();
	r.report({ callId: "a1", toolName: "bash", status: "ok" });
	r.noteUsage(500, 50);
	r.seal();
	const before = r.summary("a1")!.usage;
	r.report({ callId: "b1", toolName: "bash", status: "ok" });
	r.noteUsage(700, 70); // lands on B, must not leak into A
	assert.deepEqual(before, { input: 500, output: 50 });
	assert.deepEqual(r.summary("a1")!.usage, { input: 500, output: 50 }, "A unchanged");
	assert.deepEqual(r.summary("b1")!.usage, { input: 700, output: 70 }, "B has its own");
});
