/**
 * HUD tests — the 3 below-editor lines.
 *
 * Written against the pure `renderHud()` surface with an identity theme, so
 * assertions read as the plain text a user sees; the component shell gets its
 * own tests for the hit map, the spinner clock and the theme-switch contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	HUD_HEIGHT,
	HUD_ICONS,
	HudComponent,
	renderHud,
	type HudModel,
	type HudTheme,
	type HudWords,
} from "../src/hud.ts";
import { DEFAULT_STYLE, SPINNER_FRAME_MS } from "../src/styles.ts";
import { stringWidth } from "../src/width.ts";

/** Identity theme: assert on the plain text shape. */
const plain: HudTheme = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

const words: HudWords = {
	plan: "计划",
	noPlan: "无计划",
	running: "运行中",
	idle: "空闲",
	errors: "错误",
	points: "要点",
	turn: "本轮",
	expand: "展开",
	allDone: "全部完成",
};

const NOW = 1_700_000_000_000;

function model(over: Partial<HudModel> = {}): HudModel {
	return { plan: [], tasks: [], errors: 0, points: 0, edits: { adds: 0, dels: 0 }, ...over };
}

const idle = model();

const busy = model({
	plan: [
		{ text: "Scaffold the project", done: true },
		{ text: "Fix authentication bug", done: true },
		{ text: "Add unit tests", done: false },
		{ text: "Write documentation", done: false },
		{ text: "Ship it", done: false },
	],
	tasks: [
		{ id: "t1", toolName: "bash", detail: "pnpm test", startedAtMs: NOW - 12_000 },
		{ id: "t2", toolName: "read", detail: "src/app.ts", startedAtMs: NOW - 3_000 },
	],
	errors: 1,
	points: 3,
	edits: { adds: 24, dels: 8 },
});

function lines(m: HudModel, width = 100, now = NOW, theme: HudTheme = plain) {
	return renderHud(m, words, theme, width, now, DEFAULT_STYLE).lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// line 1 — plan
// ─────────────────────────────────────────────────────────────────────────────

test("hud line 1: done/total and the current step", () => {
	assert.deepEqual(lines(busy)[0], "⛵ 计划 2/5 · Add unit tests");
});

test("hud line 1: no plan says so", () => {
	assert.deepEqual(lines(idle)[0], "⛵ 无计划");
});

test("hud line 1: a finished plan shows the all-done word", () => {
	const done = model({ plan: [{ text: "a", done: true }] });
	assert.deepEqual(lines(done)[0], "⛵ 计划 1/1 · 全部完成");
});

// ─────────────────────────────────────────────────────────────────────────────
// line 2 — running tasks
// ─────────────────────────────────────────────────────────────────────────────

test("hud line 2: idle state", () => {
	assert.deepEqual(lines(idle)[1], "✓ 空闲");
});

test("hud line 2: count, spinner, tool, detail, elapsed per task", () => {
	const line = lines(busy)[1];
	// Same instant → same frame for both tasks (the clock, not the row, drives it).
	assert.match(line, /^▸ 运行中 2 · (\S) bash pnpm test 12s ├ \1 read src\/app\.ts 3s$/);
});

test("hud line 2: at most two tasks, the rest fold into +N", () => {
	const three = model({
		tasks: [
			{ id: "a", toolName: "bash", detail: "one", startedAtMs: NOW },
			{ id: "b", toolName: "grep", detail: "two", startedAtMs: NOW },
			{ id: "c", toolName: "read", detail: "three", startedAtMs: NOW },
		],
	});
	const line = lines(three)[1];
	assert.match(line, /^▸ 运行中 3 · .* \+1$/);
	assert.ok(!line.includes("three"), "the third task is not drawn, only counted");
});

test("hud line 2: the spinner advances with the shared clock", () => {
	const a = lines(busy, 100, NOW)[1];
	const b = lines(busy, 100, NOW + SPINNER_FRAME_MS)[1];
	assert.notEqual(a, b, "a later frame must differ or the HUD looks frozen");
	const frame = DEFAULT_STYLE.spinner[0];
	assert.equal(stringWidth(frame), 1, "every frame stays one cell wide (no layout shift)");
});

// ─────────────────────────────────────────────────────────────────────────────
// line 3 — errors / points / turn diff + hint
// ─────────────────────────────────────────────────────────────────────────────

test("hud line 3: counts, turn diff and the right-aligned hint", () => {
	const line = lines(busy, 80)[2];
	assert.match(line, /^✗ 错误 1 · ✦ 要点 3 · 本轮 \+24\/−8 +⌃Q 展开$/);
	assert.equal(stringWidth(line), 80, "the hint lands flush with the right edge");
});

test("hud line 3: zeroes still render (no layout jump between states)", () => {
	assert.match(lines(idle, 80)[2], /^✗ 错误 0 · ✦ 要点 0 · 本轮 \+0\/−0 +⌃Q 展开$/);
});

test("hud line 3: a non-zero error count uses the error token", () => {
	const named: HudTheme = { fg: (color, text) => `<${color}>${text}`, bold: (text) => text };
	const line = renderHud(busy, words, named, 100, NOW, DEFAULT_STYLE).lines[2];
	assert.ok(line.includes("<error>1"), "the failure count is the one number that must shout");
	const calm = renderHud(idle, words, named, 100, NOW, DEFAULT_STYLE).lines[2];
	assert.ok(calm.includes("<toolOutput>0"));
});

// ─────────────────────────────────────────────────────────────────────────────
// width discipline
// ─────────────────────────────────────────────────────────────────────────────

const LONG = model({
	plan: [{ text: "Refactor the entire authentication subsystem before Friday evening", done: false }],
	tasks: [
		{ id: "t1", toolName: "bash", detail: "pnpm test --reporter=verbose --coverage ---watch=false", startedAtMs: NOW - 122_000 },
		{ id: "t2", toolName: "read", detail: "src/some/deeply/nested/path/to/a/file.ts", startedAtMs: NOW - 2_000 },
	],
	errors: 12,
	points: 47,
	edits: { adds: 1234, dels: 987 },
});

test("hud never overflows: every line fits the width, emoji counted as cells", () => {
	const view = renderHud(LONG, words, plain, 80, NOW, DEFAULT_STYLE);
	assert.equal(view.lines.length, HUD_HEIGHT);
	for (const line of view.lines) {
		assert.ok(stringWidth(line) <= 80, `line overflows 80 cells: ${JSON.stringify(line)}`);
	}
});

test("hud narrow width: nothing spills, the hint and the turn diff go first", () => {
	for (const width of [1, 5, 20, 34, 40, 60]) {
		const view = renderHud(LONG, words, plain, width, NOW, DEFAULT_STYLE);
		for (const line of view.lines) {
			assert.ok(stringWidth(line) <= width, `${width} cells overflowed: ${JSON.stringify(line)}`);
		}
	}
	const narrow = renderHud(LONG, words, plain, 20, NOW, DEFAULT_STYLE).lines;
	assert.ok(!narrow[2].includes("⌃Q"), "no room for the hint at 20 cells");
	assert.ok(!narrow[2].includes("本轮"), "the turn diff drops before the error count");
	assert.ok(narrow[2].includes("错误"), "errors always survive");
});

test("hud 80 cells: the hint is kept (a normal terminal has room)", () => {
	assert.ok(lines(busy, 80)[2].includes("⌃Q 展开"));
});

test("hud wide characters: the sailing glyph is two cells", () => {
	assert.equal(stringWidth(HUD_ICONS.plan), 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// hit map
// ─────────────────────────────────────────────────────────────────────────────

test("hits: plan line and idle line open the panel", () => {
	const view = renderHud(busy, words, plain, 100, NOW, DEFAULT_STYLE);
	assert.deepEqual([...new Set(view.spans[0].map((s) => s.hit.kind))], ["panel"]);
	assert.deepEqual(
		[...new Set(renderHud(idle, words, plain, 100, NOW, DEFAULT_STYLE).spans[1].map((s) => s.hit.kind))],
		["panel"],
	);
});

test("hits: each running task owns its own column range", () => {
	const view = renderHud(busy, words, plain, 100, NOW, DEFAULT_STYLE);
	const taskSpans = view.spans[1].filter((s) => s.hit.kind === "task");
	assert.deepEqual(
		[...new Set(taskSpans.map((s) => (s.hit.kind === "task" ? s.hit.taskId : "")))],
		["t1", "t2"],
	);
	for (const span of taskSpans) assert.ok(span.x1 > span.x0);
});

test("hits: the error count and the ⌃Q hint are separate targets on one line", () => {
	const view = renderHud(busy, words, plain, 100, NOW, DEFAULT_STYLE);
	const kinds = new Set(view.spans[2].map((s) => s.hit.kind));
	assert.ok(kinds.has("error"));
	assert.ok(kinds.has("panel"));
	const last = view.spans[2][view.spans[2].length - 1];
	assert.ok(last.x1 <= 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// component shell
// ─────────────────────────────────────────────────────────────────────────────

function component(m: HudModel, theme: HudTheme = plain, onHit: (hit: any) => void = () => {}) {
	let renders = 0;
	const comp = new HudComponent({ requestRender: () => void renders++ }, theme, () => m, () => words, () => DEFAULT_STYLE, onHit);
	return { comp, renders: () => renders };
}

test("component: render returns exactly HUD_HEIGHT lines", () => {
	const { comp } = component(busy);
	assert.equal(comp.render(80).length, HUD_HEIGHT);
	assert.equal(HUD_HEIGHT, 3);
});

test("component: a click on a task row reports that task", () => {
	const hits: any[] = [];
	const { comp } = component(busy, plain, (hit) => hits.push(hit));
	comp.render(100);
	const span = renderHud(busy, words, plain, 100, Date.now(), DEFAULT_STYLE).spans[1].find((s) => s.hit.kind === "task")!;
	assert.deepEqual(comp.handleMouse({ type: "click", button: "left", x: span.x0, y: 1 }), { handled: true, render: true });
	assert.equal(hits.length, 1);
	assert.equal(hits[0].kind, "task");
});

test("component: clicks outside a target and non-left clicks stay with pi", () => {
	const hits: any[] = [];
	const { comp } = component(busy, plain, (hit) => hits.push(hit));
	comp.render(100);
	assert.equal(comp.handleMouse({ type: "click", button: "left", x: 0, y: 9 }), undefined, "no such line");
	assert.equal(comp.handleMouse({ type: "wheel", button: "none", x: 3, y: 1 }), undefined, "wheel is transcript scrolling");
	assert.equal(comp.handleMouse({ type: "click", button: "right", x: 3, y: 1 }), undefined);
	assert.deepEqual(hits, []);
});

test("component: the spinner clock only runs while work is in flight (no leak)", () => {
	const idleComp = component(idle).comp;
	idleComp.notify();
	assert.equal(idleComp.clockActive, false, "an idle HUD arms no timer");
	idleComp.dispose();
	assert.equal(idleComp.clockActive, false, "dispose is idempotent");

	const busyComp = component(busy).comp;
	busyComp.notify();
	assert.equal(busyComp.clockActive, true, "a running task arms the 180 ms clock");
	busyComp.notify();
	assert.equal(busyComp.clockActive, true, "re-notifying reuses the same clock");
	busyComp.dispose();
	assert.equal(busyComp.clockActive, false, "dispose releases it");
	busyComp.dispose();
	assert.equal(busyComp.clockActive, false);
});

test("component: a theme switch leaves no stale colors behind", () => {
	const theme = {
		fg: (color: string, text: string) => `[${color}:${text}]`,
		bold: (text: string) => `*${text}*`,
	} as HudTheme;
	const { comp } = component(busy, theme);
	const first = comp.render(80).join("\n");
	assert.ok(first.includes("[accent:"), "the first theme reached the output");

	// pi mutates the live theme object on /theme and then invalidates; a HUD
	// that stored colored strings would keep the old markers forever.
	(theme as any).fg = (color: string, text: string) => `<${color}|${text}>`;
	comp.invalidate();
	const second = comp.render(80).join("\n");
	assert.ok(!second.includes("[accent:"), "old ANSI must not survive");
	assert.ok(second.includes("<accent|"), "the new theme is applied");
});
