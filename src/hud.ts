/**
 * pi-helm HUD — the three persistent lines under the editor.
 *
 * Placement is `ctx.ui.setWidget("pi-helm:hud", factory, { placement:
 * "belowEditor" })`, i.e. a real component, not a footer replacement: pi's own
 * footer (tokens, cost, cache, context %, git branch) keeps rendering below us.
 * The HUD deliberately repeats nothing pi already shows — it carries only what
 * pi-helm itself tracks: plan progress, running tasks, errors / key points and
 * this turn's diff.
 *
 * Pure layout + a thin component shell (zero pi imports, like groups.ts):
 *   - `renderHud()` is a pure function of (model, words, theme, width, clock)
 *     so `node --test` can pin the clock and assert on display cells;
 *   - no themed string is ever stored: `render()` rebuilds the colored lines on
 *     every frame, so a theme switch can never leave stale ANSI behind (the one
 *     thing the TUI cannot clean up for us);
 *   - the spinner reuses pi-helm's single 180 ms clock (`SPINNER_FRAME_MS`);
 *     the component starts it when work starts and stops it when the last task
 *     settles, so an idle session costs zero timers (contract #7).
 *
 * Mouse: widgets only receive mouse events in fullscreen (alt-screen) mode —
 * regular mode leaves the pointer to the terminal because the terminal owns the
 * scrollback. Every hit therefore has a keyboard equivalent (⌃Q / /mission).
 */

import { SPINNER_FRAME_MS, spinnerFrame, type Style } from "./styles.ts";
import { clipToWidth, stringWidth } from "./width.ts";

/** Widget key — namespaced so no other extension can collide with it. */
export const HUD_WIDGET_KEY = "pi-helm:hud";

/** Fixed height: plan / running / stats. Not configurable by design. */
export const HUD_HEIGHT = 3;

/** Semantic theme tokens only — no hardcoded colors (No-Fight contract). */
export type HudColor = "accent" | "dim" | "error" | "success" | "warning" | "toolOutput" | "muted";

/** The slice of pi's `Theme` the HUD needs (tests pass an identity theme). */
export interface HudTheme {
	fg(color: HudColor, text: string): string;
	bold(text: string): string;
}

export interface HudPlanStep {
	text: string;
	done: boolean;
}

export interface HudTask {
	id: string;
	toolName: string;
	detail: string;
	startedAtMs: number;
}

/** Everything the HUD draws, handed over as plain data (no pi objects). */
export interface HudModel {
	plan: readonly HudPlanStep[];
	tasks: readonly HudTask[];
	/** Key points of kind "error". */
	errors: number;
	/** Every key point, errors included. */
	points: number;
	/** This turn's diff so far. */
	edits: { adds: number; dels: number };
}

export interface HudWords {
	plan: string;
	noPlan: string;
	running: string;
	idle: string;
	errors: string;
	points: string;
	turn: string;
	expand: string;
	allDone: string;
}

/** What a click on a HUD cell means. */
export type HudHit = { kind: "panel" } | { kind: "error" } | { kind: "task"; taskId: string };

/** Half-open column range [x0, x1) on one HUD line. */
export interface HudHitSpan {
	x0: number;
	x1: number;
	hit: HudHit;
}

export interface HudView {
	lines: string[];
	spans: HudHitSpan[][];
}

/** Glyphs kept together so a future style override has one place to touch. */
export const HUD_ICONS = {
	plan: "⛵",
	running: "▸",
	idle: "✓",
	error: "✗",
	point: "✦",
	hotkey: "⌃Q",
} as const;

/** At most this many running tasks share line 2; the rest become `+N`. */
const MAX_TASK_ITEMS = 2;

// ---------------------------------------------------------------------------
// segments → cells
// ---------------------------------------------------------------------------

interface Seg {
	/** Plain (uncolored) text. Colors are applied at paint time. */
	text: string;
	color?: HudColor;
	bold?: boolean;
	hit?: HudHit;
	/** Shortened to `…` when the line is too wide (the last such seg wins). */
	flex?: boolean;
	/** Dropped as one trailing run when the line does not fit. */
	drop?: boolean;
	/** Live spinner frame: same cell width every frame, substituted at paint. */
	spin?: boolean;
}

interface Placed {
	seg: Seg;
	text: string;
	x0: number;
	width: number;
}

function textOf(seg: Seg, spin: string): string {
	return seg.spin ? spin : seg.text;
}

/** Clip to `room` cells, marking the cut with `…` when there is space for it. */
function fitText(text: string, room: number): string {
	if (stringWidth(text) <= room) return text;
	if (room <= 0) return "";
	if (room === 1) return clipToWidth(text, 1);
	return `${clipToWidth(text, room - 1)}…`;
}

/**
 * Place segments on one line of `width` cells.
 *
 * Three passes, cheapest first: drop the trailing optional run whole (never a
 * dangling `├`), shorten the last flexible segment, and only then hard-clip.
 */
function layoutLine(segs: readonly Seg[], width: number, spin: string): Placed[] {
	let work = [...segs];
	const measure = (seg: Seg) => stringWidth(textOf(seg, spin));
	const total = () => work.reduce((n, seg) => n + measure(seg), 0);

	while (total() > width && work.length > 0 && work[work.length - 1].drop) {
		let start = work.length - 1;
		while (start > 0 && work[start - 1].drop) start--;
		work = work.slice(0, start);
	}

	if (total() > width) {
		let flex = -1;
		for (let i = work.length - 1; i >= 0; i--) {
			if (work[i].flex) {
				flex = i;
				break;
			}
		}
		if (flex >= 0) {
			const others = total() - measure(work[flex]);
			const room = Math.max(0, width - others);
			work[flex] = { ...work[flex], text: fitText(work[flex].text, room), spin: false };
		}
	}

	const placed: Placed[] = [];
	let x = 0;
	for (const seg of work) {
		const text = textOf(seg, spin);
		const w = stringWidth(text);
		if (x + w <= width) {
			placed.push({ seg, text, x0: x, width: w });
			x += w;
			continue;
		}
		const clipped = fitText(text, width - x);
		if (clipped) placed.push({ seg, text: clipped, x0: x, width: stringWidth(clipped) });
		break;
	}
	return placed;
}

function paintSeg(theme: HudTheme, text: string, seg: Seg): string {
	const colored = seg.color ? theme.fg(seg.color, text) : text;
	return seg.bold ? theme.bold(colored) : colored;
}

function spansOf(placed: readonly Placed[]): HudHitSpan[] {
	const spans: HudHitSpan[] = [];
	for (const item of placed) {
		if (!item.seg.hit || item.width === 0) continue;
		spans.push({ x0: item.x0, x1: item.x0 + item.width, hit: item.seg.hit });
	}
	return spans;
}

// ---------------------------------------------------------------------------
// the three lines (pure segment builders)
// ---------------------------------------------------------------------------

const PANEL_HIT: HudHit = { kind: "panel" };
const ERROR_HIT: HudHit = { kind: "error" };

function sep(style: Style): Seg {
	return { text: ` ${style.sep} `, color: "dim" };
}

/** Line 1 — `⛵ 计划 2/5 · Fix authentication bug`. */
function planSegs(model: HudModel, words: HudWords, style: Style): Seg[] {
	const total = model.plan.length;
	const done = model.plan.filter((step) => step.done).length;
	const segs: Seg[] = [{ text: HUD_ICONS.plan, color: "accent", hit: PANEL_HIT }, { text: " " }];
	if (total === 0) {
		// No plan reads as `⛵ 无计划` — the extra label would just be noise.
		segs.push({ text: words.noPlan, color: "muted", hit: PANEL_HIT });
		return segs;
	}
	segs.push({ text: words.plan, color: "dim", hit: PANEL_HIT }, { text: " " });
	const current = model.plan.find((step) => !step.done);
	segs.push({ text: `${done}/${total}`, color: "toolOutput", hit: PANEL_HIT });
	segs.push(sep(style));
	// The step text is the only part that may be shortened.
	segs.push({ text: current?.text ?? words.allDone, color: "dim", flex: true });
	return segs;
}

/** One running task: `⠋ 🔨 bash  pnpm test 12s`. */
function taskSegs(task: HudTask, nowMs: number, style: Style): Seg[] {
	const hit: HudHit = { kind: "task", taskId: task.id };
	const secs = Math.max(0, Math.round((nowMs - task.startedAtMs) / 1000));
	const segs: Seg[] = [
		{ text: "", spin: true, color: "warning", hit },
		{ text: " " },
		{ text: task.toolName, bold: true, hit },
	];
	if (task.detail) segs.push({ text: " " }, { text: task.detail, color: "dim", flex: true, hit });
	segs.push({ text: " " }, { text: `${secs}s`, color: "dim", hit });
	return segs;
}

/** Line 2 — `▸ 运行中 2 · ⠋ bash … 12s ├ ⠙ read … 3s`, or `✓ 空闲`. */
function tasksSegs(model: HudModel, words: HudWords, style: Style, nowMs: number): Seg[] {
	if (model.tasks.length === 0) {
		return [
			{ text: HUD_ICONS.idle, color: "success", hit: PANEL_HIT },
			{ text: " " },
			{ text: words.idle, color: "dim", hit: PANEL_HIT },
		];
	}
	const segs: Seg[] = [
		{ text: HUD_ICONS.running, color: "warning", hit: PANEL_HIT },
		{ text: " " },
		{ text: words.running, color: "dim", hit: PANEL_HIT },
		{ text: " " },
		{ text: String(model.tasks.length), color: "toolOutput", hit: PANEL_HIT },
		sep(style),
	];
	const shown = model.tasks.slice(0, MAX_TASK_ITEMS);
	shown.forEach((task, index) => {
		const item = taskSegs(task, nowMs, style);
		if (index === 0) {
			segs.push(...item);
			return;
		}
		// Second task + its separator go as one droppable run on narrow terminals.
		segs.push({ text: " ├ ", color: "dim", drop: true });
		for (const seg of item) segs.push({ ...seg, drop: true });
	});
	if (model.tasks.length > MAX_TASK_ITEMS) {
		segs.push({ text: ` +${model.tasks.length - MAX_TASK_ITEMS}`, color: "dim", drop: true });
	}
	return segs;
}

/** Line 3 — `✗ 错误 0 · ✦ 要点 3 · 本轮 +24/−8` (+ right-aligned `⌃Q 展开`). */
function statsSegs(model: HudModel, words: HudWords, style: Style): Seg[] {
	return [
		{ text: HUD_ICONS.error, color: "error", hit: ERROR_HIT },
		{ text: " " },
		{ text: words.errors, color: "dim", hit: ERROR_HIT },
		{ text: " " },
		// A non-zero failure count is the one number that must shout.
		{ text: String(model.errors), color: model.errors > 0 ? "error" : "toolOutput", hit: ERROR_HIT },
		sep(style),
		{ text: HUD_ICONS.point, color: "accent" },
		{ text: " " },
		{ text: words.points, color: "dim" },
		{ text: " " },
		{ text: String(model.points), color: "toolOutput" },
		{ ...sep(style), drop: true },
		{ text: words.turn, color: "dim", drop: true },
		{ text: " ", drop: true },
		{ text: `+${model.edits.adds}`, color: "success", drop: true },
		{ text: "/", color: "dim", drop: true },
		{ text: `−${model.edits.dels}`, color: "error", drop: true },
	];
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

/**
 * Pure: the three HUD lines for one instant plus the clickable column ranges.
 *
 * `plan` is threaded through so callers that cache segment plans stay honest,
 * but the built-in component rebuilds every frame — three short lines cost less
 * than validating a cache, and rebuilding is what keeps old ANSI out of state.
 */
export function renderHud(
	model: HudModel,
	words: HudWords,
	theme: HudTheme,
	width: number,
	nowMs: number,
	style: Style,
): HudView {
	if (width <= 0) return { lines: [], spans: [] };
	const spin = model.tasks.length > 0 ? spinnerFrame(nowMs, style.spinner) : (style.spinner[0] ?? " ");
	const plan: Seg[][] = [planSegs(model, words, style), tasksSegs(model, words, style, nowMs), statsSegs(model, words, style)];
	const hint: Seg = { text: `${HUD_ICONS.hotkey} ${words.expand}`, color: "accent", hit: PANEL_HIT };
	const hintWidth = stringWidth(hint.text);

	const lines: string[] = [];
	const spans: HudHitSpan[][] = [];
	for (let index = 0; index < plan.length; index++) {
		const isStatsLine = index === plan.length - 1;
		// Keep the hint only while a readable left side survives next to it
		// (16 cells ≈ the error/point counts plus one separator).
		const keepHint = isStatsLine && width - hintWidth - 1 >= 16;
		const placed = layoutLine(plan[index], keepHint ? width - hintWidth - 1 : width, spin);
		let text = placed.map((item) => paintSeg(theme, item.text, item.seg)).join("");
		const used = placed.reduce((n, item) => n + item.width, 0);
		const lineSpans = spansOf(placed);
		if (keepHint) {
			const pad = Math.max(1, width - used - hintWidth);
			text += " ".repeat(pad) + paintSeg(theme, hint.text, hint);
			lineSpans.push({ x0: used + pad, x1: used + pad + hintWidth, hit: PANEL_HIT });
		}
		lines.push(text);
		spans.push(lineSpans);
	}
	return { lines, spans };
}

// ---------------------------------------------------------------------------
// component shell
// ---------------------------------------------------------------------------

/**
 * The widget component. `render()` is stateless apart from the hit map (the
 * only cross-frame data it keeps, and it holds no themed text).
 */
export class HudComponent {
	private spans: HudHitSpan[][] = [];
	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly tui: { requestRender(): void };
	private readonly theme: HudTheme;
	private readonly getModel: () => HudModel;
	private readonly getWords: () => HudWords;
	private readonly getStyle: () => Style;
	private readonly onHit: (hit: HudHit) => void;

	// Explicit fields (not TS parameter properties): `node --experimental-strip-types`
	// rejects those, and this file must stay runnable by the test runner.
	constructor(
		tui: { requestRender(): void },
		theme: HudTheme,
		getModel: () => HudModel,
		getWords: () => HudWords,
		getStyle: () => Style,
		onHit: (hit: HudHit) => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.getModel = getModel;
		this.getWords = getWords;
		this.getStyle = getStyle;
		this.onHit = onHit;
	}

	render(width: number): string[] {
		const model = this.getModel();
		const view = renderHud(model, this.getWords(), this.theme, width, Date.now(), this.getStyle());
		this.spans = view.spans;
		return view.lines;
	}

	handleMouse(event: { type: string; button: string; x: number; y: number }): { handled: boolean; render: boolean } | undefined {
		// Wheel/right/middle stay with pi (transcript scrolling is not ours).
		if (event.type !== "click" || event.button !== "left") return undefined;
		const row = this.spans[event.y];
		if (!row) return undefined;
		const span = row.find((item) => event.x >= item.x0 && event.x < item.x1);
		if (!span) return undefined;
		this.onHit(span.hit);
		return { handled: true, render: true };
	}

	/**
	 * State changed: repaint and keep the shared spinner clock running only
	 * while something is actually in flight.
	 */
	notify(): void {
		const running = this.getModel().tasks.length > 0;
		if (running && !this.timer) {
			this.timer = setInterval(() => this.tui.requestRender(), SPINNER_FRAME_MS);
			// A background clock must never keep the process alive.
			(this.timer as unknown as { unref?: () => void }).unref?.();
		} else if (!running) {
			this.stopClock();
		}
		this.tui.requestRender();
	}

	/** Theme switched or the TUI asked for a fresh build: drop cached data. */
	invalidate(): void {
		this.spans = [];
	}

	dispose(): void {
		this.stopClock();
		this.spans = [];
	}

	/** Test seam: is the 180 ms clock currently armed? */
	get clockActive(): boolean {
		return this.timer !== undefined;
	}

	private stopClock(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}
}
