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
): string {
	const marker = theme.fg(level === 0 ? "accent" : "warning", level === 0 ? "▸" : "▾");
	const head = `${marker} ${theme.bold(`${summary.count} call${summary.count === 1 ? "" : "s"}`)}`;
	const parts = [head];
	if (summary.breakdown.length > 0) {
		parts.push(theme.fg("dim", summary.breakdown.map((e) => `${e.name}×${e.count}`).join(" ")));
	}
	if (summary.failed > 0) parts.push(theme.fg("error", `${summary.failed} failed`));
	if (summary.running > 0) parts.push(theme.fg("warning", `● ${summary.running} running`));
	if (summary.usage) {
		parts.push(theme.fg("dim", `↑${fmtTokens(summary.usage.input)} ↓${fmtTokens(summary.usage.output)}`));
	}
	if (summary.durationMs > 0) parts.push(theme.fg("dim", fmtDuration(summary.durationMs)));
	return parts.join(" · ");
}

export interface RowParts {
	status: ToolStatus;
	toolName: string;
	/** The goal phrase the schema injection collected: `[check test failures]`. */
	reasoning?: string;
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
	running: { mark: "●", color: "warning" },
};

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
export function fmtRow(parts: RowParts, theme: ThemeLike, gutter = true): string {
	const glyph = GLYPH[parts.status];
	const head = [
		theme.fg(glyph.color, glyph.mark),
		theme.bold(parts.toolName),
		parts.reasoning ? theme.fg("accent", `[${parts.reasoning}]`) : undefined,
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
		.join(" · ");
	const line = tail ? `${head} · ${tail}` : head;
	return gutter ? `${theme.fg("dim", "└")} ${line}` : line;
}

export interface PinnedParts {
	status: ToolStatus;
	toolName: string;
	icon?: string;
	/** Target of the call: path etc. */
	label?: string;
	outcome?: string;
	durationMs?: number;
	usage?: { input: number; output: number };
}

/** Header of an always-shown tool card (edit/write: the diff is the point). */
export function fmtPinned(parts: PinnedParts, theme: ThemeLike): string {
	const glyph = GLYPH[parts.status];
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
	]
		.filter((s): s is string => typeof s === "string" && s.length > 0)
		.map((s) => theme.fg(glyph.color, s))
		.join(" · ");
	return tail ? `${head} · ${tail}` : head;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic call description (works for built-ins, MCP and third-party tools)
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_ICONS: Record<string, string> = {
	read: "📖",
	bash: "⚡",
	edit: "✏️",
	write: "📝",
	grep: "🔎",
	find: "🗂",
	ls: "📂",
};

function textOf(result: any): string {
	return (result?.content ?? [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => c.text)
		.join("\n");
}

function clip(text: string, width: number): string {
	return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function detailOf(toolName: string, args: any): string {
	let detail = "";
	if (typeof args?.command === "string") detail = args.command.replace(/\s+/g, " ").trim();
	else if (typeof args?.path === "string") detail = args.path;
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
	const m = text.match(/exit code: (\d+)/);
	if (m) return m[1] === "0" ? "done" : `exit ${m[1]}`;
	const n = text.split("\n").filter((l: string) => l.trim()).length;
	return n > 0 ? `${n} lines` : "ok";
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

/** ANSI-aware width clip, so no runtime pi-tui import is needed. */
function clipLine(line: string, width: number): string {
	let visible = 0;
	let out = "";
	for (let i = 0; i < line.length; i++) {
		if (line[i] === "\x1b") {
			const end = line.indexOf("m", i);
			if (end > 0) {
				out += line.slice(i, end + 1);
				i = end;
				continue;
			}
		}
		if (visible >= width) return `${out}…`;
		out += line[i];
		visible++;
	}
	return out;
}

export class GroupLine {
	private hits: (Hit | null)[] = [];
	private readonly buildView: () => CallView;
	private readonly onHit: (hit: Hit) => void;

	constructor(buildView: () => CallView, onHit: (hit: Hit) => void) {
		this.buildView = buildView;
		this.onHit = onHit;
	}

	render(width: number): string[] {
		const view = this.buildView();
		this.hits = view.hits;
		return view.lines.map((l) => clipLine(l, width));
	}

	handleMouse(event: { type: string; button: string; y: number }): { handled: boolean; render: boolean } | undefined {
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
}

/** Per-call live bookkeeping: the 1s clock and the reveal timer. */
const clocks = new Map<string, ReturnType<typeof setInterval>>();
const reveals = new Map<string, ReturnType<typeof setTimeout>>();
const componentsByCallId = new Map<string, Set<GroupLine>>();
const expandedSeen = new Map<string, boolean>();

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

function ensureClock(registry: GroupRegistry, id: string, invalidate: () => void): void {
	if (clocks.has(id)) return;
	const timer = setInterval(() => tickGroup(registry, id, invalidate), 1000);
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
}

export function createToolResolver(options: ResolverOptions) {
	const { registry } = options;
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
		const member = (registry.membersOf(id) ?? []).find((m) => m.callId === id);
		const elapsed = member?.startedAt !== undefined ? Math.max(0, now() - member.startedAt) : undefined;
		const parts: RowParts = {
			status: phase === "running" ? "running" : phase === "error" ? "error" : "ok",
			toolName,
			reasoning: typeof args?.reasoning === "string" && args.reasoning.trim() ? args.reasoning.trim() : undefined,
			detail: detailOf(toolName, args),
			outcome:
				phase === "running"
					? elapsed === undefined
						? "running"
						: `running ${fmtDuration(elapsed)}`
					: outcomeOf(result, phase === "error"),
			durationMs: phase === "running" ? undefined : durationMs,
			usage: member?.usage,
		};
		const lines: string[] = [];
		const hits: (Hit | null)[] = [];

		if (registry.isPinned(id)) {
			lines.push(
				fmtPinned(
					{
						status: parts.status,
						toolName,
						icon: TOOL_ICONS[toolName],
						label: parts.detail,
						outcome: parts.outcome,
						durationMs: parts.durationMs,
						usage: parts.usage,
					},
					theme,
				),
			);
			hits.push(null);
			const body = phase === "running" ? argsLines(args) : bodyLines(result);
			for (const line of body) {
				lines.push(theme.fg("toolOutput", line));
				hits.push(null);
			}
			return { lines, hits };
		}

		if (plan.header) {
			const summary = registry.summary(id) ?? buildSummary(registry.membersOf(id) ?? []);
			lines.push(fmtSummaryLine(summary, plan.header === "closed" ? 0 : 1, theme));
			hits.push("toggle-header");
		}
		if (plan.full) {
			lines.push(fmtRow(parts, theme));
			hits.push("close-full");
			const body = phase === "running" ? argsLines(args) : bodyLines(result);
			for (const line of body) {
				lines.push(theme.fg("toolOutput", line));
				hits.push("close-full");
			}
		} else if (plan.line) {
			lines.push(fmtRow(parts, theme));
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
		const component = new GroupLine(
			() => viewOf(id, toolName, args, result, phase, theme, durationMs),
			(hit) => {
				if (hit === "toggle-header") registry.toggleHeader(id);
				else if (hit === "open-row") registry.rowClick(id);
				else registry.noteSetExpanded(id, false, true);
				tickGroup(registry, id, invalidate);
			},
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
				const isError = options?.isError === true || result?.isError === true;
				report(id, toolName, {
					status: isError ? "error" : "ok",
					durationMs: typeof options?.durationMs === "number" ? options.durationMs : undefined,
				});
				syncExpanded(id, (options?.expanded ?? context?.expanded) === true);
				clearClock(id);
				return wire(id, toolName, context?.args ?? args, result, isError ? "error" : "done", theme, options?.durationMs, () =>
					context?.invalidate?.(),
				);
			},
		};
	};
}
