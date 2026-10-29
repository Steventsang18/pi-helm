/**
 * pi-helm group folding — render glue.
 *
 * Pure line formatters (theme-like interface, node --test friendly), a
 * self-shell GroupLine component, and a registerToolRenderer resolver chain
 * that draws four states per call: group summary header / row / pinned full /
 * empty. Zero runtime pi imports — everything structural — which is also what
 * lets the tests import this file directly.
 *
 * §No-Fight Contract: no prototype patches, resolver returns `next()` for
 * anything it does not draw, all UI keys namespaced in index.ts.
 */

import {
	GroupRegistry,
	buildSummary,
	type ToolCallRecord,
	type ToolStatus,
	type ViewPlan,
} from "./groups.ts";
import { homedir } from "os";
import { words } from "./strings.ts";
import { DEFAULT_STYLE, spinnerFrame, SPINNER_FRAME_MS, type Style } from "./styles.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Theme-like interface (the real Theme structurally satisfies this)
// ─────────────────────────────────────────────────────────────────────────────

export interface ThemeLike {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure formatting
// ─────────────────────────────────────────────────────────────────────────────

export function fmtDuration(ms?: number): string {
	if (ms === undefined) return "";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * The group's one summary line: `▸ 5 calls · bash×3 read×2 · 2 failed · ▶ 1 running · 1.2s`
 * Level 0 folds (`▸`), level 1 unfolds (`▾`). The failure count sticks to the
 * summary however deep the group is folded — the point of folding is that a
 * failure is still announced.
 */
export function fmtSummaryLine(
	summary: {
		count: number;
		breakdown: readonly { name: string; count: number }[];
		failed: number;
		running: number;
		durationMs: number;
		usage?: { input: number; output: number };
	},
	level: 0 | 1,
	theme: ThemeLike,
	style: Style = DEFAULT_STYLE,
	/** Spinner frame for the live `running` segment (defaults to the clock's frame). */
	frame?: string,
): string {
	const marker = theme.fg(level === 0 ? "accent" : "warning", level === 0 ? style.marker : style.openMarker);
	const head = `${marker} ${theme.bold(words().calls(summary.count))}`;
	const parts = [head];
	if (summary.breakdown.length > 0) {
		// C: icon first — tool type at a glance; unknown tools keep their name
		parts.push(theme.fg("dim", summary.breakdown.map((e) => `${style.icons[e.name] ?? e.name}×${e.count}`).join(" ")));
	}
	if (summary.failed > 0) parts.push(theme.fg("error", `✗ ${words().failed(summary.failed)}`));
	if (summary.running > 0) parts.push(theme.fg("warning", `${frame ?? spinnerFrame(Date.now(), style.spinner)} ${words().running(summary.running)}`));
	if (summary.usage) {
		parts.push(theme.fg("dim", `↑${fmtTokens(summary.usage.input)} ↓${fmtTokens(summary.usage.output)}`));
	}
	if (summary.durationMs > 0) parts.push(theme.fg("dim", fmtDuration(summary.durationMs)));
	return parts.join(` ${style.sep} `);
}

export interface RowParts {
	status: ToolStatus;
	toolName: string;
	/** Spinner frame for a running call (clock-derived by viewOf; tests pin it). */
	frame?: string;
	/** The goal phrase the schema injection collected: `[check test failures]`. */
	reasoning?: string;
	/**
	 * Localized "what this tool does" (`运行命令`) — fills the reason slot
	 * only when the model sent no reasoning: reason-first stays primary, the
	 * catalog is the deterministic bilingual fallback (§requirement 1).
	 */
	desc?: string;
	/** Command / path — what the call is about. */
	detail?: string;
	/** What it produced: `exit 1`, `12 lines`, `running 2s`. */
	outcome?: string;
	durationMs?: number;
	/** Token usage: shows `↑1.2k ↓169` when present. */
	usage?: { input: number; output: number };
}

const GLYPH: Record<ToolStatus, { mark: string; color: string }> = {
	ok: { mark: "✓", color: "success" },
	error: { mark: "✗", color: "error" },
	// `running` is animated: fmtRow/fmtPinned swap in the clock-derived frame
	// (see spinnerFrame). This mark is the static fallback only.
	running: { mark: "●", color: "warning" },
};

/** The glyph for a status; a running call animates through the spinner frames. */
function glyphFor(status: ToolStatus, frame?: string, style: Style = DEFAULT_STYLE): { mark: string; color: string } {
	const base = GLYPH[status];
	if (status !== "running") return base;
	return { mark: frame ?? spinnerFrame(Date.now(), style.spinner), color: base.color };
}

/** Format token count compactly: 1234 → "1.2k", 999999 → "999k". */
function fmtTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * The one-row view of a call inside an open group:
 * `└ ✓ bash [check test failures] pnpm test · exit 1 · ↑1.2k ↓169 · 1.8s`
 */
export function fmtRow(parts: RowParts, theme: ThemeLike, gutter = true, style: Style = DEFAULT_STYLE): string {
	const glyph = glyphFor(parts.status, parts.frame, style);
	const reasonSlot = parts.reasoning
		? theme.fg("accent", `[${parts.reasoning}]`)
		: parts.desc
			? theme.fg("dim", `[${parts.desc}]`)
			: undefined;
	const head = [
		theme.fg(glyph.color, glyph.mark),
		theme.bold(parts.toolName),
		reasonSlot,
		parts.detail ? theme.fg("dim", parts.detail) : undefined,
	]
		.filter((s): s is string => typeof s === "string" && s.length > 0)
		.join(" ");
	const tail = [
		parts.outcome,
		parts.usage ? `↑${fmtTokens(parts.usage.input)} ↓${fmtTokens(parts.usage.output)}` : undefined,
		fmtDuration(parts.durationMs) || undefined,
	]
		.filter((s): s is string => typeof s === "string" && s.length > 0)
		.map((s) => theme.fg(glyph.color, s))
		.join(` ${style.sep} `);
	const line = tail ? `${head} ${style.sep} ${tail}` : head;
	return gutter ? `${theme.fg("dim", style.rowGutter)} ${line}` : line;
}

export interface PinnedParts {
	status: ToolStatus;
	toolName: string;
	icon?: string;
	/** Spinner frame for a running call (clock-derived by viewOf; tests pin it). */
	frame?: string;
	/** Target of the call: path etc. */
	label?: string;
	outcome?: string;
	durationMs?: number;
	usage?: { input: number; output: number };
	/** Total body lines — shown in the header tail when > 1 (`· 142 lines`). */
	totalLines?: number;
}

/** Header of an always-shown tool card (edit/write: the diff is the point). */
export function fmtPinned(parts: PinnedParts, theme: ThemeLike, style: Style = DEFAULT_STYLE): string {
	const glyph = glyphFor(parts.status, parts.frame, style);
	const head = [
		theme.fg(glyph.color, glyph.mark),
		parts.icon,
		theme.bold(parts.toolName),
		parts.label ? theme.fg("dim", parts.label) : undefined,
	]
		.filter((s): s is string => typeof s === "string" && s.length > 0)
		.join(" ");
	const tail = [
		parts.outcome,
		parts.usage ? `↑${fmtTokens(parts.usage.input)} ↓${fmtTokens(parts.usage.output)}` : undefined,
		fmtDuration(parts.durationMs) || undefined,
		parts.totalLines !== undefined && parts.totalLines > 1 ? words().lines(parts.totalLines) : undefined,
	]
		.filter((s): s is string => typeof s === "string" && s.length > 0)
		.map((s) => theme.fg(glyph.color, s))
		.join(` ${style.sep} `);
	return tail ? `${head} ${style.sep} ${tail}` : head;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic call description (works for built-ins, MCP and third-party tools)
// ─────────────────────────────────────────────────────────────────────────────

function textOf(result: any): string {
	return (result?.content ?? [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => c.text)
		.join("\n");
}

function clip(text: string, width: number): string {
	return stringWidth(text) <= width ? text : `${clipToWidth(text, Math.max(1, width - 1))}…`;
}

/** Absolute paths shrink (`/Users/me/x` → `~/x`) — shorter lines, no username leak. */
export function shortenPath(path: string): string {
	try {
		const home = homedir();
		if (home && home !== "/" && path.startsWith(home)) return `~${path.slice(home.length)}`;
	} catch {
		// no homedir (odd sandbox) — show the path as-is
	}
	return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display-width aware clipping (emoji/CJK are double-width in every terminal
// we support; counting UTF-16 units — the old code — misaligns them all)
// ─────────────────────────────────────────────────────────────────────────────

/** Emoji_Presentation code points inside otherwise narrow blocks (⚡ U+26A1 …). */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
	[0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
	[0xfe30, 0xfe6f], [0xff00, 0xff60], [0x1f000, 0x1faff],
	// narrow-block singles that terminals draw as emoji (all our TOOL_ICONS)
	[0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
	[0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
	[0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
	[0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
	[0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
	[0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
	[0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
	[0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
	[0x2b55, 0x2b55],
];

function isWide(cp: number): boolean {
	for (const [lo, hi] of WIDE_RANGES) {
		if (cp >= lo && cp <= hi) return true;
	}
	return false;
}

/** Cells one code point occupies. Zero-width marks, ZWJ and skin tones add nothing. */
function cellWidth(cp: number): number {
	if (cp === 0x200d) return 0; // ZWJ
	if (cp >= 0x1f3fb && cp <= 0x1f3ff) return 0; // skin-tone modifiers ride the base emoji
	if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) ||
		(cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f))
		return 0;
	if (cp === 0xfe0f) return 0; // VS16: handled as an upgrade of the previous cell (below)
	if (cp >= 0xfe00 && cp <= 0xfe0e) return 0;
	return isWide(cp) ? 2 : 1;
}

/** Terminal cell width of a plain (no ANSI) string. */
export function stringWidth(text: string): number {
	let width = 0;
	let lastWidth = 0;
	let afterZwj = false;
	for (const ch of text) {
		const cp = ch.codePointAt(0)!;
		if (cp === 0xfe0f) {
			// VS16 flips a text-presentation char (✏ U+270F) to emoji width
			if (lastWidth === 1) width += 1;
			continue;
		}
		if (cp === 0x200d) {
			afterZwj = true; // the emoji after a ZWJ joins the same grapheme
			continue;
		}
		const w = cellWidth(cp);
		width += afterZwj && w > 0 ? 0 : w;
		if (w > 0) afterZwj = false;
		lastWidth = w;
	}
	return width;
}

/** Clip a plain string to `width` cells on a code-point boundary. */
function clipToWidth(text: string, width: number): string {
	let out = "";
	let used = 0;
	for (const ch of text) {
		const w = cellWidth(ch.codePointAt(0)!);
		if (used + w > width) break;
		out += ch;
		used += w;
	}
	return out;
}

export function detailOf(toolName: string, args: any): string {
	let detail = "";
	if (typeof args?.command === "string") detail = args.command.replace(/\s+/g, " ").trim();
	else if (typeof args?.path === "string") detail = shortenPath(args.path);
	else if (typeof args?.pattern === "string") detail = String(args.pattern);
	else if (typeof args?.query === "string") detail = args.query;
	return clip(detail, 90);
}

export function outcomeOf(result: any, isError: boolean): string {
	const text = textOf(result);
	if (isError) {
		const first = text.split("\n").find((l: string) => l.trim()) ?? "error";
		return clip(first, 60);
	}
	// edit/write: the diff stat is the headline (`+12/−3`), not line noise
	const diff = result?.details?.diff;
	if (typeof diff === "string" && diff.trim()) {
		let adds = 0;
		let dels = 0;
		for (const line of diff.split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) adds++;
			else if (line.startsWith("-") && !line.startsWith("---")) dels++;
		}
		if (adds > 0 || dels > 0) return `+${adds}/−${dels}`;
	}
	const m = text.match(/exit code: (\d+)/);
	if (m) return m[1] === "0" ? words().done : `exit ${m[1]}`;
	const n = text.split("\n").filter((l: string) => l.trim()).length;
	return n > 0 ? words().lines(n) : words().ok;
}

function bodyLines(result: any): string[] {
	const diff = result?.details?.diff;
	const body = typeof diff === "string" && diff.trim() ? diff : textOf(result);
	return body.split("\n").slice(0, 200);
}

function argsLines(args: any): string[] {
	try {
		return JSON.stringify(args ?? {}, null, 2).split("\n").slice(0, 200);
	} catch {
		return [];
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GroupLine — self-shell component (render / handleMouse / invalidate)
// ─────────────────────────────────────────────────────────────────────────────

type Hit = "toggle-header" | "open-row" | "close-full";

interface CallView {
	lines: string[];
	/** What a click on each rendered line means. */
	hits: (Hit | null)[];
}

const EMPTY_VIEW: CallView = { lines: [], hits: [] };

/** ANSI-aware clip to `width` cells, emoji/CJK counted double (see stringWidth). */
function clipLine(line: string, width: number): string {
	let visible = 0;
	let lastWidth = 0;
	let out = "";
	let i = 0;
	while (i < line.length) {
		if (line[i] === "\x1b") {
			const end = line.indexOf("m", i);
			if (end > 0) {
				out += line.slice(i, end + 1);
				i = end + 1;
				continue;
			}
		}
		const cp = line.codePointAt(i)!;
		const ch = String.fromCodePoint(cp);
		if (cp === 0xfe0f) {
			if (lastWidth === 1) visible += 1; // VS16 widens the previous cell
			out += ch;
			i += ch.length;
			continue;
		}
		const w = cellWidth(cp);
		if (visible + w > width) return `${out}…`;
		visible += w;
		lastWidth = w;
		out += ch;
		i += ch.length;
	}
	return out;
}

export class GroupLine {
	private hits: (Hit | null)[] = [];
	private readonly buildView: () => CallView;
	private readonly onHit: (hit: Hit) => void;
	private readonly onWheel?: (delta: number) => { handled: boolean; render: boolean } | undefined;

	constructor(
		buildView: () => CallView,
		onHit: (hit: Hit) => void,
		onWheel?: (delta: number) => { handled: boolean; render: boolean } | undefined,
	) {
		this.buildView = buildView;
		this.onHit = onHit;
		this.onWheel = onWheel;
	}

	render(width: number): string[] {
		const view = this.buildView();
		this.hits = view.hits;
		return view.lines.map((l) => clipLine(l, width));
	}

	handleMouse(event: { type: string; button: string; y: number; wheelDelta?: number }): { handled: boolean; render: boolean } | undefined {
		// Wheel: only the scrollable pinned box consumes it (contain semantics —
		// at the boundary we still consume so the transcript never jumps).
		// Returning undefined lets the event fall through to pi's global scroll.
		if (event.type === "wheel") {
			return this.onWheel?.(event.wheelDelta ?? 0);
		}
		if (event.type !== "click" || event.button !== "left") return undefined;
		if (event.y < 0 || event.y >= this.hits.length) return undefined;
		const hit = this.hits[event.y];
		if (hit) this.onHit(hit);
		// Every click on our lines is consumed — pi's expand toggle stays a
		// keyboard-only (ctrl+o) signal, so the two never fight.
		return { handled: true, render: true };
	}

	invalidate(): void {
		// Nothing cached: render() rebuilds lazily every frame (LazyLines mode).
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver-chain glue
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolRenderersLike {
	renderShell?: "default" | "self";
	renderCall?: (args: any, theme: any, context: any) => any;
	renderResult?: (result: any, options: any, theme: any, context: any) => any;
}

export interface ResolverOptions {
	registry: GroupRegistry;
	/** When this returns false the resolver is a pure pass-through (kill switch). */
	enabled?: () => boolean;
	/** Tools whose own rendering wins (never folded, never drawn by us). */
	neverFold?: readonly string[];
	now?: () => number;
	/** Display style (glyphs/icons/separators) — settings.json DIY layer. */
	style?: Style;
	/** Viewport height for scrollable pinned boxes (Task 003). */
	bodyHeight?: () => number;
}

/** Per-call live bookkeeping: the running clock and the reveal timer. */
const clocks = new Map<string, ReturnType<typeof setInterval>>();
const reveals = new Map<string, ReturnType<typeof setTimeout>>();
const componentsByCallId = new Map<string, Set<GroupLine>>();
const expandedSeen = new Map<string, boolean>();
/** Pinned-box scroll position per call (Task 003). Cleared on session_shutdown. */
const pinnedScroll = new Map<string, number>();

/** Default viewport height for scrollable pinned boxes (Task 003). */
export const DEFAULT_PINNED_BODY_HEIGHT = 14;

function rememberComponent(id: string, component: GroupLine): void {
	let set = componentsByCallId.get(id);
	if (!set) {
		set = new Set();
		componentsByCallId.set(id, set);
	}
	set.add(component);
	// pi rebuilds components on every invalidate; drop the oldest so a long
	// running call cannot accumulate one object per tick.
	while (set.size > 4) {
		const oldest = set.values().next().value;
		if (oldest === undefined) break;
		set.delete(oldest);
	}
}

/** Repaint every component of this call's group: the summary line is live. */
function tickGroup(registry: GroupRegistry, id: string, invalidate: () => void): void {
	for (const member of registry.membersOf(id) ?? []) {
		for (const component of componentsByCallId.get(member.callId) ?? []) component.invalidate();
	}
	for (const component of componentsByCallId.get(id) ?? []) component.invalidate();
	invalidate();
}

/**
 * Test seam: how many animation/timer handles this layer currently owns.
 * Zero once every running call settled and the session shut down (contract #7).
 */
export function activeTimerCount(): { clocks: number; reveals: number } {
	return { clocks: clocks.size, reveals: reveals.size };
}

function ensureClock(registry: GroupRegistry, id: string, invalidate: () => void): void {
	if (clocks.has(id)) return;
	// One interval per running call, at spinner speed: the frame is derived from
	// the clock, so the repaint rate and the animation rate must match or the
	// spinner stutters. Cleared on settle (clearClock) and on shutdown.
	const timer = setInterval(() => tickGroup(registry, id, invalidate), SPINNER_FRAME_MS);
	timer.unref?.(); // never hold the process open on our account
	clocks.set(id, timer);
}

function ensureReveal(registry: GroupRegistry, id: string, revealIn: number, invalidate: () => void): void {
	if (reveals.has(id) || revealIn <= 0) return;
	const timer = setTimeout(() => {
		reveals.delete(id);
		tickGroup(registry, id, invalidate);
	}, revealIn);
	timer.unref?.();
	reveals.set(id, timer);
}

function clearClock(id: string): void {
	const timer = clocks.get(id);
	if (timer) clearInterval(timer);
	clocks.delete(id);
	const reveal = reveals.get(id);
	if (reveal) clearTimeout(reveal);
	reveals.delete(id);
}

/** session_shutdown: drop every timer this layer owns (contract #7). */
export function disposeAllRenderers(): void {
	for (const timer of clocks.values()) clearInterval(timer);
	clocks.clear();
	for (const reveal of reveals.values()) clearTimeout(reveal);
	reveals.clear();
	componentsByCallId.clear();
	expandedSeen.clear();
	pinnedScroll.clear();
}

export function createToolResolver(options: ResolverOptions) {
	const { registry } = options;
	const style = options.style ?? DEFAULT_STYLE;
	const bodyHeight = options.bodyHeight ?? (() => DEFAULT_PINNED_BODY_HEIGHT);
	const now = options.now ?? (() => Date.now());

	const isDrawn = (toolName: string): boolean => {
		if (options.enabled && !options.enabled()) return false;
		if (options.neverFold?.includes(toolName)) return false;
		return true;
	};

	/** Render-time report: idempotent, so a call joins its group exactly once. */
	const report = (id: string, toolName: string, patch: Partial<ToolCallRecord>): void => {
		registry.report({ callId: id, toolName, status: "running", startedAt: now(), ...patch });
		registry.update(id, patch);
	};

	/**
	 * pi's own expand flag, translated into levels. Only a real *change*
	 * counts: the first sighting of a folded call must not collapse the group
	 * (a late joiner renders with `expanded: false` all the time). An arrival
	 * that is already expanded is ctrl+o's expand-all — pi hands that to every
	 * box, so it does open the group.
	 */
	const syncExpanded = (id: string, expanded: boolean): void => {
		const seen = expandedSeen.get(id);
		if (seen === expanded) return;
		if (seen === undefined && !expanded) {
			expandedSeen.set(id, false);
			return;
		}
		expandedSeen.set(id, expanded);
		registry.noteSetExpanded(id, expanded, false);
	};

	const viewOf = (
		id: string,
		toolName: string,
		args: any,
		result: any,
		phase: "running" | "done" | "error",
		theme: ThemeLike,
		durationMs: number | undefined,
	): CallView => {
		const plan: ViewPlan = registry.planFor(id) ?? { header: null, line: false, full: false, gutter: false };
		// recordOf covers pinned too — membersOf() never returns them, which is
		// exactly how edit/write cards lost their ↑↓ tail (3a fix)
		const record = registry.recordOf(id);
		const elapsed = record?.startedAt !== undefined ? Math.max(0, now() - record.startedAt) : undefined;
		const reasoning = typeof args?.reasoning === "string" && args.reasoning.trim() ? args.reasoning.trim() : undefined;
		const parts: RowParts = {
			status: phase === "running" ? "running" : phase === "error" ? "error" : "ok",
			toolName,
			// the single place a frame is derived for this call: same instant, same frame
			frame: phase === "running" ? spinnerFrame(now(), style.spinner) : undefined,
			// reason-first: the model's phrase wins, the catalog describes the rest
			reasoning,
			desc: reasoning ? undefined : words().describe(toolName),
			detail: detailOf(toolName, args),
			outcome:
				phase === "running"
					? elapsed === undefined
						? words().inProgress
						: words().runningFor(fmtDuration(elapsed))
					: outcomeOf(result, phase === "error"),
			durationMs: phase === "running" ? undefined : durationMs ?? record?.durationMs,
			usage: record?.usage,
		};
		const lines: string[] = [];
		const hits: (Hit | null)[] = [];

		if (registry.isPinned(id)) {
			// Task 003: fixed-height viewport + wheel scroll for long bodies.
			// Short bodies keep natural height (no indicators, no scroll state).
			const body = phase === "running" ? argsLines(args) : bodyLines(result);
			const total = body.length;
			const cap = Math.max(1, bodyHeight());
			const scrollable = total > cap;
			let scrollTop = 0;
			if (scrollable) {
				scrollTop = Math.min(pinnedScroll.get(id) ?? 0, total - cap);
				pinnedScroll.set(id, scrollTop);
			} else {
				pinnedScroll.delete(id); // content shrank — drop stale position
			}
			lines.push(
				fmtPinned(
					{
						status: parts.status,
						toolName,
						frame: parts.frame,
						icon: style.icons[toolName],
						label: parts.detail,
						outcome: parts.outcome,
						durationMs: parts.durationMs,
						usage: parts.usage,
						totalLines: total,
					},
					theme,
					style,
				),
			);
			hits.push(null);
			const visible = scrollable ? body.slice(scrollTop, scrollTop + cap) : body;
			if (scrollTop > 0) {
				lines.push(theme.fg("dim", words().moreAbove(scrollTop)));
				hits.push(null);
			}
			for (const line of visible) {
				lines.push(theme.fg("toolOutput", line));
				hits.push(null);
			}
			const below = total - scrollTop - visible.length;
			if (below > 0) {
				lines.push(theme.fg("dim", words().moreBelow(below)));
				hits.push(null);
			}
			return { lines, hits };
		}

		if (plan.header) {
			const summary = registry.summary(id) ?? buildSummary(registry.membersOf(id) ?? []);
			lines.push(fmtSummaryLine(summary, plan.header === "closed" ? 0 : 1, theme, style, spinnerFrame(now(), style.spinner)));
			hits.push("toggle-header");
		}
		if (plan.full) {
			lines.push(fmtRow(parts, theme, true, style));
			hits.push("close-full");
			const body = phase === "running" ? argsLines(args) : bodyLines(result);
			for (const line of body) {
				lines.push(theme.fg("toolOutput", line));
				hits.push("close-full");
			}
		} else if (plan.line) {
			lines.push(fmtRow(parts, theme, true, style));
			hits.push("open-row");
		}
		return { lines, hits };
	};

	const wire = (
		id: string,
		toolName: string,
		args: any,
		result: any,
		phase: "running" | "done" | "error",
		theme: ThemeLike,
		durationMs: number | undefined,
		invalidate: () => void,
		revealIn?: number,
	): GroupLine => {
		// Task 003: wheel consumer for scrollable pinned boxes. Contain
		// semantics — at the boundary we still consume the event so the
		// transcript never jumps under the cursor (acceptance 4). Short
		// bodies return undefined → pi's global scroll keeps working.
		const onWheel = registry.isPinned(id)
			? (delta: number): { handled: boolean; render: boolean } | undefined => {
					const body = phase === "running" ? argsLines(args) : bodyLines(result);
					const cap = Math.max(1, bodyHeight());
					const total = body.length;
					if (total <= cap) return undefined;
					const current = pinnedScroll.get(id) ?? 0;
					const max = total - cap;
					const next = Math.min(max, Math.max(0, current + delta));
					if (next === current) return { handled: true, render: false }; // at edge: swallow
					pinnedScroll.set(id, next);
					return { handled: true, render: true };
				}
			: undefined;
		const component = new GroupLine(
			() => viewOf(id, toolName, args, result, phase, theme, durationMs),
			(hit) => {
				if (hit === "toggle-header") registry.toggleHeader(id);
				else if (hit === "open-row") registry.rowClick(id);
				else registry.noteSetExpanded(id, false, true);
				tickGroup(registry, id, invalidate);
			},
			onWheel,
		);
		rememberComponent(id, component);
		if (phase === "running") ensureClock(registry, id, invalidate);
		if (revealIn !== undefined) ensureReveal(registry, id, revealIn, invalidate);
		return component;
	};

	return (toolName: string, next: () => ToolRenderersLike | undefined): ToolRenderersLike | undefined => {
		if (!isDrawn(toolName)) return next();
		return {
			renderShell: "self",
			// draws while the call streams (single owner per phase)
			renderCall(args: any, theme: ThemeLike, context: any) {
				if (!context?.isPartial) return new GroupLine(() => EMPTY_VIEW, () => {});
				const id = String(context.toolCallId ?? "");
				report(id, toolName, { status: "running" });
				syncExpanded(id, context.expanded === true);
				const plan = registry.planFor(id);
				return wire(id, toolName, args, undefined, "running", theme, undefined, () => context.invalidate?.(), plan?.revealIn);
			},
			// draws once the call settles
			renderResult(result: any, options: any, theme: ThemeLike, context: any) {
				if (options?.isPartial) return new GroupLine(() => EMPTY_VIEW, () => {});
				const id = String(context?.toolCallId ?? "");
				// pi runtime shape (tool-execution.js getRenderContext): options =
				// {expanded, isPartial} ONLY; isError and durationMs live on context
				// (3a fix — the old options.isError/offsets read undefined)
				const isError = context?.isError === true || options?.isError === true || result?.isError === true;
				const settled =
					typeof context?.durationMs === "number"
						? context.durationMs
						: typeof options?.durationMs === "number"
							? options.durationMs
							: undefined;
				report(id, toolName, {
					status: isError ? "error" : "ok",
					durationMs: settled,
				});
				syncExpanded(id, (options?.expanded ?? context?.expanded) === true);
				clearClock(id);
				return wire(id, toolName, context?.args ?? args, result, isError ? "error" : "done", theme, settled, () =>
					context?.invalidate?.(),
				);
			},
		};
	};
}
