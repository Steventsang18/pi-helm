/**
 * pi-helm — mission control for your Pi session.
 *
 * v0.2: group folding (own implementation, zero prototype patches).
 *   - Layer 1  src/groups.ts     pure state machine (no pi import, unit-tested)
 *   - Layer 2  src/renderers.ts  resolver-chain glue + self-shell GroupLine
 *   - Layer 3  this file         event wiring, conflict ladder, mission panel
 *
 * Folding semantics absorbed from pi-tidy (MIT, Andy8647/pi-tidy):
 * boundary/carrier classification, 1s anti-flicker delay, sticky failure
 * count, edit/write never fold. Expression is our own; see README credits.
 *
 * Mission features kept from v2: overlay dashboard (/mission + hotkey),
 * plan parsing, task grid, key points, i18n (/lang zh|en), /demo-seed.
 *
 * Usage:  pi -e ./index.ts    (or install as a pi package, or /reload)
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { homedir } from "os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GroupRegistry, buildSummary, classifyAssistant, rebuildFromEntries, type EntryLike, type ToolCallRecord } from "./groups.ts";
import { HUD_WIDGET_KEY, HudComponent, type HudHit, type HudModel, type HudWords } from "./hud.ts";
import { createToolResolver, disposeAllRenderers, fmtSummaryLine, type ThemeLike } from "./renderers.ts";
import { setLang } from "./strings.ts";
import { DEFAULT_STYLE, mergeStyle, panelRuleDashes, spinnerFrame, SPINNER_FRAME_MS, type Style } from "./styles.ts";

const STATUS_KEY = "pi-helm:mission";
const PILL_TYPE = "pi-helm:pill";
/** v2 stored pills under this type — keep rendering them after the rename. */
const PILL_TYPE_LEGACY = "mission-pill";

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

type Lang = "zh" | "en";

const T = {
	zh: {
		mission: "MISSION",
		plan: "计划",
		tasks: "任务",
		points: "要点",
		noPlan: "（暂无计划 — 让 agent 输出 “Plan:” 编号步骤，或 /demo-seed）",
		allDone: "全部完成",
		running: "运行中",
		noTasks: "（无运行中任务）",
		noPoints: "（无要点 — 出错或到达里程碑时自动出现）",
		footerHint: "⌃Q 面板",
		help: "↑↓ 选择要点 · Enter/Esc 关闭",
		seedCmd: "注入假任务，立即看全貌",
		clearCmd: "清空任务状态",
		langCmd: "切换界面语言 zh/en",
		seedDone: "示例任务已注入，按 Alt+G 查看",
		cleared: "已清空",
		langSwitched: "界面语言已切换",
		milestoneRecorded: "里程碑已记录",
		phaseThinking: "思考中…",
		phaseWriting: "撰写回复…",
		turnChanges: (files: number, adds: number, dels: number) =>
			`本轮改动 · ${files} 文件 · +${adds}/−${dels}`,
		runningWord: "运行中",
	},
	en: {
		mission: "MISSION",
		plan: "PLAN",
		tasks: "TASKS",
		points: "KEY POINTS",
		noPlan: '(no plan - have the agent emit numbered steps under "Plan:", or run /demo-seed)',
		allDone: "all done",
		running: "running",
		noTasks: "(nothing running)",
		noPoints: "(no key points yet - errors and milestones land here)",
		footerHint: "⌃Q panel",
		help: "up/down select - Enter/Esc close",
		seedCmd: "inject a fake mission for instant preview",
		clearCmd: "clear mission state",
		langCmd: "switch UI language zh/en",
		seedDone: "Fake mission injected - press Alt+G",
		cleared: "cleared",
		langSwitched: "UI language switched",
		milestoneRecorded: "Milestone recorded",
		phaseThinking: "thinking…",
		phaseWriting: "writing…",
		turnChanges: (files: number, adds: number, dels: number) =>
			`Turn changes: ${files} file${files === 1 ? "" : "s"} · +${adds}/-${dels}`,
		runningWord: "running",
	},
} as const;

// ---------------------------------------------------------------------------
// HUD words (the 3 below-editor lines; separate from the panel's table because
// the HUD needs short lowercase labels, the panel uses section headings)
// ---------------------------------------------------------------------------

const HUD_WORDS: { zh: HudWords; en: HudWords } = {
	zh: {
		plan: "计划",
		noPlan: "无计划",
		running: "运行中",
		idle: "空闲",
		errors: "错误",
		points: "要点",
		turn: "本轮",
		openPanel: "面板展开",
		allDone: "全部完成",
	},
	en: {
		plan: "plan",
		noPlan: "no plan",
		running: "running",
		idle: "idle",
		errors: "errors",
		points: "points",
		turn: "this turn",
		openPanel: "open panel",
		allDone: "all done",
	},
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function shortenPath(p: string): string {
	const home = homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function fmtClock(ts: number): string {
	const d = new Date(ts);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

function textOf(result: any): string {
	return (result?.content ?? [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => c.text)
		.join("\n");
}

function parsePlanSteps(text: string): string[] {
	const lines = text.split("\n");
	const steps: string[] = [];
	let inPlan = false;
	for (const line of lines) {
		if (/^\s*Plan\s*[:：]\s*$/.test(line)) {
			inPlan = true;
			continue;
		}
		if (!inPlan) continue;
		const m = line.match(/^\s*(\d+)\.\s+(.*)$/);
		if (m) steps.push(m[2].trim());
		else if (line.trim() === "") continue;
		else break;
	}
	return steps;
}

/** The part of a tool call worth showing: its command / path / pattern. */
function taskDetail(args: any): string {
	if (typeof args?.command === "string") return args.command.replace(/\s+/g, " ").trim();
	if (typeof args?.path === "string") return shortenPath(args.path);
	if (typeof args?.pattern === "string") return String(args.pattern);
	return "";
}

function taskLabel(toolName: string, args: any): string {
	return truncateToWidth(`${toolName}  ${taskDetail(args)}`, 60);
}

// ---------------------------------------------------------------------------
// mission state
// ---------------------------------------------------------------------------

interface PlanStep {
	text: string;
	done: boolean;
}

interface TaskRow {
	id: string;
	label: string;
	/** Kept apart from `label` so the HUD can style the tool name and detail differently. */
	toolName: string;
	detail: string;
	startedAt: number;
	nested: number;
}

interface KeyPoint {
	kind: "error" | "milestone";
	text: string;
	ts: number;
}

const state = {
	plan: [] as PlanStep[],
	tasks: new Map<string, TaskRow>(),
	points: [] as KeyPoint[],
	version: 0,
};

let lang: Lang = "zh";
const t = () => T[lang];

let footerTui: { requestRender(): void } | undefined;
/** Live HUD widget, when one is mounted (TUI + `hudEnabled`). */
let hudComp: HudComponent | undefined;

function refresh() {
	state.version++;
	footerTui?.requestRender();
	hudComp?.notify();
}

function pushPoint(kind: KeyPoint["kind"], text: string) {
	state.points.push({ kind, text, ts: Date.now() });
	if (state.points.length > 50) state.points.splice(0, state.points.length - 50);
}

function appendPill(pi: ExtensionAPI, kind: KeyPoint["kind"], text: string) {
	pi.appendEntry<{ text: string; ts: number; kind: KeyPoint["kind"] }>(PILL_TYPE, { text, ts: Date.now(), kind });
}

function paintStatus(ctx: any) {
	if (!ctx.hasUI) return;
	// With the HUD mounted the same mission numbers already sit under the
	// editor; two copies would just add noise. Non-TUI keeps the status line.
	if (hudComp) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const theme: Theme = ctx.ui.theme;
	const total = state.plan.length;
	const done = state.plan.filter((s) => s.done).length;
	const plan = total > 0 ? theme.fg("toolOutput", `${done}/${total}`) : "";
	const running = state.tasks.size > 0 ? theme.fg("warning", ` ▶${state.tasks.size}`) : "";
	const errs = state.points.filter((p) => p.kind === "error").length;
	const err = errs ? theme.fg("error", ` ✗${errs}`) : "";
	ctx.ui.setStatus(
		STATUS_KEY,
		`${plan}${running}${err}${plan || running || err ? " " : ""}${theme.fg("dim", t().footerHint)}`,
	);
}

// ---------------------------------------------------------------------------
// reasoning schema injection (conflict ladder, contract #3)
// ---------------------------------------------------------------------------

const REASONING_DESC =
	'One short phrase stating the GOAL/intent behind this call (not the file or command, which are shown already), e.g. "check test failures"';

/** Inject an optional guided `reasoning` param; strip it before delegating. */
function withReasoning(def: any): any {
	const original = def.parameters ?? {};
	const props = { ...(original.properties ?? {}) };
	if (!("reasoning" in props)) props.reasoning = { type: "string", description: REASONING_DESC };
	const parameters = { ...original, properties: props };
	const origExecute = def.execute.bind(def);
	return {
		...def,
		parameters,
		promptGuidelines: [
			...(def.promptGuidelines ?? []),
			`Always pass a "reasoning" phrase with each ${def.name} call: state the GOAL/intent, not the file or command.`,
		],
		async execute(id: any, params: any, signal: any, onUpdate: any, ctx: any) {
			const { reasoning: _reasoning, ...rest } = params ?? {};
			return origExecute(id, rest, signal, onUpdate, ctx);
		},
	};
}

// per-call path bookkeeping (for the turn-diff pill)
const pathByCallId = new Map<string, string>();

const diffStats = (diff: unknown): { adds: number; dels: number } => {
	let adds = 0;
	let dels = 0;
	if (typeof diff === "string") {
		for (const line of diff.split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) adds++;
			else if (line.startsWith("-") && !line.startsWith("---")) dels++;
		}
	}
	return { adds, dels };
};

// ---------------------------------------------------------------------------
// group folding: config + conflict ladder (contracts #3 / #5 / #8)
// ---------------------------------------------------------------------------

interface HelmConfig {
	enabled: boolean;
	hotkey: string;
	workingMessage: boolean;
	fold: boolean;
	neverFold: string[];
	/** A: one-call groups render their row directly instead of `▸ 1 call`. */
	autoRow: boolean;
	/** New groups open at level 1 (▾ + per-call rows) instead of folded. */
	defaultExpand: boolean;
	/** Viewport height for scrollable edit/write boxes. */
	pinnedBodyHeight: number;
	/** Interface language: settings default; `/lang` flips it for the session. */
	lang: Lang;
	/** Built-in style + settings.json DIY overrides (contract: same namespace). */
	style: Style;
	/**
	 * Persistent 3-line HUD under the editor (belowEditor widget). Off by
	 * default: with it off the interface is byte-for-byte what it was before.
	 */
	hudEnabled: boolean;
}

const cfg: HelmConfig = {
	enabled: true,
	// ⌃Q: a plain ctrl byte — every macOS terminal delivers it as-is (⌥ keys
	// need "Option as Meta" configured; see README). macOS key notation below.
	hotkey: "ctrl+q",
	workingMessage: true,
	fold: true,
	neverFold: [],
	autoRow: true,
	defaultExpand: false,
	pinnedBodyHeight: 14,
	lang: "zh",
	style: DEFAULT_STYLE,
	hudEnabled: false,
};
const registry = new GroupRegistry();
let reasoningInjected = true;
let degradeNotified = false;

const plainTheme: ThemeLike = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

/**
 * Apply one parsed `pi-helm` settings object to cfg (pure, shared by both
 * readers below).
 */
function applyConfig(raw: any) {
	if (!raw || typeof raw !== "object") return;
	if (typeof raw.enabled === "boolean") cfg.enabled = raw.enabled;
	if (typeof raw.hotkey === "string" && raw.hotkey) cfg.hotkey = raw.hotkey;
	if (typeof raw.workingMessage === "boolean") cfg.workingMessage = raw.workingMessage;
	if (typeof raw.fold === "boolean") cfg.fold = raw.fold;
	if (Array.isArray(raw.neverFold)) cfg.neverFold = raw.neverFold.filter((x: unknown): x is string => typeof x === "string");
	if (typeof raw.autoRow === "boolean") cfg.autoRow = raw.autoRow;
	if (typeof raw.defaultExpand === "boolean") cfg.defaultExpand = raw.defaultExpand;
	if (typeof raw.pinnedBodyHeight === "number" && Number.isFinite(raw.pinnedBodyHeight)) {
		cfg.pinnedBodyHeight = Math.max(4, Math.min(40, Math.floor(raw.pinnedBodyHeight)));
	}
	if (raw.lang === "zh" || raw.lang === "en") cfg.lang = raw.lang;
	if (typeof raw.hudEnabled === "boolean") cfg.hudEnabled = raw.hudEnabled;
	if (raw.style && typeof raw.style === "object") cfg.style = mergeStyle(raw.style);
}

/**
 * pi 1.3.0 constraint (verified 2026-10-28): `pi.getSettings()` THROWS during
 * extension loading ("Extension runtime not initialized") — runtime.getSettings
 * is only wired in runner.bindCore(), after all factories ran. A settings read
 * in the factory must therefore go to disk. We read the GLOBAL settings file
 * directly; pi's own project-settings merge is re-applied on session_start
 * below, when the official API is live. Registration-time keys (hotkey,
 * enabled→reasoning injection) only honor this global read — documented.
 */
function readConfigFromDisk() {
	try {
		const path = join(getAgentDir(), "settings.json");
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		applyConfig(parsed?.["pi-helm"]);
	} catch {
		// unreadable settings — defaults stand
	}
}

/** session_start re-read via the official API (global + project merged). */
function readConfig(pi: ExtensionAPI) {
	try {
		applyConfig((pi.getSettings() as any)?.["pi-helm"]);
	} catch {
		// settings unavailable in some modes — disk values stand
	}
	setLang(cfg.lang); // strings.ts is the single word-table for rows/summaries
}

/**
 * Contract #3 — tool ownership ladder. The reasoning head needs our schema to
 * own the tool definition, so we try registerTool() per built-in tool; a hard
 * failure (someone else already registered that name) degrades to render-only
 * mode: folding and compact rows stay, the reasoning head is gone, and the
 * user is notified once.
 */
function registerReasoningTools(pi: ExtensionAPI, cwd: string) {
	const defs = [
		createReadToolDefinition(cwd),
		createBashToolDefinition(cwd),
		createEditToolDefinition(cwd),
		createWriteToolDefinition(cwd),
		createGrepToolDefinition(cwd),
		createFindToolDefinition(cwd),
		createLsToolDefinition(cwd),
	];
	for (const def of defs) {
		try {
			pi.registerTool(withReasoning(def));
		} catch {
			reasoningInjected = false;
		}
	}
}

// ---------------------------------------------------------------------------
// L1 overlay dashboard component
// ---------------------------------------------------------------------------

class MissionOverlay {
	private sel = 0;
	private cache?: string[];
	private cacheW?: number;
	private cacheKey?: string;
	private timer: ReturnType<typeof setInterval>;

	constructor(
		private tui: { requestRender(): void },
		private theme: Theme,
		private done: () => void,
		private focus?: { taskId?: string; sel?: number },
	) {
		// Opening the panel *on* a HUD hit (a key point, a running task) starts
		// with that row already selected instead of always at the top.
		this.sel = Math.min(Math.max(0, focus?.sel ?? 0), Math.max(0, state.points.length - 1));
		// Spinner-speed refresh, but only while something actually runs: an idle
		// panel needs no repaint (elapsed seconds only tick for running tasks).
		this.timer = setInterval(() => {
			if (state.tasks.size === 0) return;
			this.invalidate();
			this.tui.requestRender();
		}, SPINNER_FRAME_MS);
	}

	handleInput(data: string): void {
		const max = Math.max(0, state.points.length - 1);
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "enter") || data === "q") {
			this.done();
			return;
		}
		if (matchesKey(data, "up")) {
			this.sel = Math.max(0, this.sel - 1);
		} else if (matchesKey(data, "down")) {
			this.sel = Math.min(max, this.sel + 1);
		} else {
			return;
		}
		this.invalidate();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const key = `${state.version}:${this.sel}:${lang}:${this.spinnerFrame()}`;
		if (this.cache && this.cacheW === width && this.cacheKey === key) return this.cache;
		const th = this.theme;
		const tt = t();
		const frame = this.spinnerFrame();
		const lines: string[] = [];
		const inner = Math.max(20, width - 4);

		// Dashes counted in display cells, not UTF-16 units: 🤖 happens to be
		// 2/2 today, but a single-width or ZWJ prefix would bend the border.
		const title = `🤖 ${tt.mission}`;
		lines.push(
			th.fg("accent", `┌─ ${title} `) +
				th.fg("dim", `${"─".repeat(panelRuleDashes(title, inner))}`) +
				th.fg("accent", "┐"),
		);

		const total = state.plan.length;
		const done = state.plan.filter((s) => s.done).length;
		lines.push(
			th.bold(`│ ${tt.plan}`) +
				(total > 0
					? `  ${th.fg("accent", `[${"▓".repeat(done)}${"░".repeat(total - done)}]`)} ${th.fg("toolOutput", `${done}/${total}`)}`
					: ""),
		);
		if (total === 0) {
			lines.push(th.fg("muted", `│   ${truncateToWidth(tt.noPlan, inner - 3)}`));
		} else {
			const current = state.plan.find((x) => !x.done);
			for (const s of state.plan) {
				const glyph = s.done
					? th.fg("success", "✓")
					: s === current
						? th.fg("warning", "▶")
						: th.fg("dim", "·");
				lines.push(`│   ${glyph} ${th.fg(s.done ? "dim" : "toolOutput", truncateToWidth(s.text, inner - 6))}`);
			}
		}

		lines.push(
			th.bold(`│ ${tt.tasks}`) + (state.tasks.size > 0 ? th.fg("warning", `  ${frame} ${state.tasks.size} ${tt.running}`) : ""),
		);
		const running = [...state.tasks.values()].slice(0, 6);
		if (running.length === 0) {
			lines.push(th.fg("muted", `│   ${tt.noTasks}`));
		} else {
			for (const task of running) {
				const secs = Math.round((Date.now() - task.startedAt) / 1000);
				const extra = task.nested > 0 ? th.fg("dim", ` ·${task.nested}↓`) : "";
				const body = `${th.fg("warning", frame)} ${th.fg("toolOutput", truncateToWidth(task.label, inner - 14))} ${th.fg("dim", `${secs}s`)}${extra}`;
				lines.push(
					task.id === this.focus?.taskId ? `│ ${th.style(` ${body} `, { bg: "customMessageBg" })}` : `│   ${body}`,
				);
			}
		}

		lines.push(th.bold(`│ ${tt.points}`));
		const pts = state.points.slice(-8);
		if (pts.length === 0) {
			lines.push(th.fg("muted", `│   ${tt.noPoints}`));
		} else {
			const offset = state.points.length - pts.length;
			for (let i = 0; i < pts.length; i++) {
				const p = pts[i];
				const selected = i + offset === this.sel;
				const glyph = p.kind === "error" ? th.fg("error", "✗") : th.fg("accent", "✦");
				const body = `${fmtClock(p.ts)} ${p.text}`;
				const line = `${glyph} ${th.fg(selected ? "toolOutput" : "muted", truncateToWidth(body, inner - 8))}`;
				lines.push(selected ? `│ ${th.style(` ${line} `, { bg: "customMessageBg" })}` : `│   ${line}`);
			}
		}

		lines.push(
			th.fg("dim", `└─ ${tt.help}`) +
				th.fg("dim", `${"─".repeat(panelRuleDashes(tt.help, inner))}`) +
				th.fg("dim", "┘"),
		);

		this.cache = lines;
		this.cacheW = width;
		this.cacheKey = key;
		return lines;
	}

	/** The running indicator for this instant (idle: the first frame, still). */
	private spinnerFrame(): string {
		return state.tasks.size > 0 ? spinnerFrame(Date.now(), cfg.style.spinner) : cfg.style.spinner[0];
	}

	invalidate(): void {
		this.cache = undefined;
	}

	dispose(): void {
		clearInterval(this.timer);
	}
}

// ---------------------------------------------------------------------------
// extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();
	// pi 1.3.0: getSettings() throws during factory — read the disk copy now,
	// re-merge officially on session_start (see readConfigFromDisk).
	readConfigFromDisk();
	lang = cfg.lang; // panel i18n follows settings; /lang flips both together
	registry.setAutoRow(cfg.autoRow);
	registry.setDefaultExpand(cfg.defaultExpand);

	// ===== L0: group folding (resolver chain, contract #2) ==================
	pi.registerToolRenderer(
		createToolResolver({
			registry,
			enabled: () => cfg.enabled && cfg.fold,
			neverFold: cfg.neverFold,
			style: cfg.style,
			bodyHeight: () => cfg.pinnedBodyHeight,
		}),
	);

	// ===== L0: reasoning schema injection (contract #3) =====================
	if (cfg.enabled) registerReasoningTools(pi, cwd);

	// ===== L0: milestone pill entry renderer =================================
	const pillRenderer = (entry: any, _opts: any, theme: Theme) => {
		const d = entry.data;
		if (!d) return new Text("", 0, 0);
		const isErr = d.kind === "error";
		const glyph = isErr ? "✗" : "✦";
		const color = isErr ? "error" : "accent";
		return new Text(
			theme.fg("dim", "── ") +
				theme.fg(color, `${glyph} ${d.text}`) +
				theme.fg("dim", ` ${fmtClock(d.ts)} `) +
				theme.fg("dim", "──"),
			0,
			0,
		);
	};
	pi.registerEntryRenderer<{ text: string; ts: number; kind: KeyPoint["kind"] }>(PILL_TYPE, pillRenderer);
	pi.registerEntryRenderer<{ text: string; ts: number; kind: KeyPoint["kind"] }>(PILL_TYPE_LEGACY, pillRenderer);

	// ===== L1: overlay dashboard =============================================
	const openOverlay = async (ctx: any, focus?: { taskId?: string; sel?: number }) => {
		if (!ctx.hasUI) return;
		await ctx.ui.custom<boolean>(
			(tui: any, theme: Theme, _kb: any, done: (r: boolean) => void) => new MissionOverlay(tui, theme, () => done(true), focus),
			{
				overlay: true,
				overlayOptions: {
					width: "76%",
					maxHeight: "80%",
					anchor: "center",
					margin: 2,
				},
			},
		);
	};

	// ===== L2: HUD under the editor (belowEditor widget) ====================
	//
	// Mission info pi's own footer cannot know (plan progress / running tasks /
	// errors / turn diff). The built-in footer keeps every one of its fields —
	// this is an addition below it, never a replacement.
	const hudWords = (): HudWords => HUD_WORDS[lang];

	const hudModel = (): HudModel => ({
		plan: state.plan,
		tasks: [...state.tasks.values()].map((row) => ({
			id: row.id,
			toolName: row.toolName,
			detail: row.detail,
			startedAtMs: row.startedAt,
		})),
		errors: state.points.filter((p) => p.kind === "error").length,
		points: state.points.length,
		edits: {
			adds: turnEdits.reduce((n, x) => n + x.adds, 0),
			dels: turnEdits.reduce((n, x) => n + x.dels, 0),
		},
	});

	/** Index of the newest error key point (where a `✗` click sends the panel). */
	const lastErrorIndex = () => {
		for (let i = state.points.length - 1; i >= 0; i--) if (state.points[i].kind === "error") return i;
		return 0;
	};

	const mountHud = (ctx: any) => {
		ctx.ui.setWidget(
			HUD_WIDGET_KEY,
			(tui: any, theme: Theme) => {
				const comp = new HudComponent(tui, theme, hudModel, hudWords, () => cfg.style, (hit: HudHit) => {
					if (hit.kind === "task") void openOverlay(ctx, { taskId: hit.taskId });
					else if (hit.kind === "error") void openOverlay(ctx, { sel: lastErrorIndex() });
					else void openOverlay(ctx);
				});
				hudComp = comp;
				return comp;
			},
			{ placement: "belowEditor" },
		);
	};

	const clearHud = (ctx: any) => {
		hudComp = undefined;
		// Only the interactive TUI has widgets; RPC/JSON/print would throw.
		if (!ctx?.hasUI || ctx.mode !== "tui") return;
		ctx.ui.setWidget(HUD_WIDGET_KEY, undefined);
	};

	const syncHud = (ctx: any) => {
		if (cfg.enabled && cfg.hudEnabled && ctx.hasUI && ctx.mode === "tui") mountHud(ctx);
		else clearHud(ctx);
	};

	// macOS key convention: ⌃Q works everywhere; ⌥G (alias) fires on terminals
	// with "Option as Meta" enabled. /mission is the always-on escape hatch.
	const hotkeys = cfg.hotkey === "alt+g" ? [cfg.hotkey] : [cfg.hotkey, "alt+g"];
	for (const key of hotkeys) {
		try {
			pi.registerShortcut(key, {
				description: "Open mission control dashboard",
				handler: openOverlay,
			});
		} catch {
			// key taken by another extension — /mission still works
		}
	}

	pi.registerShortcut("ctrl+shift+m", {
		description: "Open mission control dashboard",
		handler: openOverlay,
	});

	pi.registerCommand("mission", {
		description: "打开指挥台面板（快捷键 ⌃Q 的命令行替代）",
		handler: openOverlay,
	});

	// contract #8: one-key exit
	pi.registerCommand("helm", {
		description: "pi-helm 总开关：/helm off|on|toggle",
		handler: async (args, ctx) => {
			const v = args.trim().toLowerCase();
			if (v === "off") cfg.enabled = false;
			else if (v === "on") cfg.enabled = true;
			else if (v === "toggle") cfg.enabled = !cfg.enabled;
			// The kill switch takes the HUD with it, no restart needed.
			syncHud(ctx);
			ctx.ui.notify(`pi-helm: ${cfg.enabled ? "on" : "off"}${v ? "" : " (usage: /helm off|on|toggle)"}`, "info");
			paintStatus(ctx);
		},
	});

	// ===== events: tasks / errors / plan / turn-diff / phase =================

	pi.on("tool_execution_start", (e: any) => {
		const record: ToolCallRecord = { callId: e.toolCallId, toolName: e.toolName, status: "running", startedAt: Date.now() };
		registry.report(record);
		turnCalls.push({ ...record });
		if ((e.toolName === "edit" || e.toolName === "write") && typeof e?.args?.path === "string") {
			pathByCallId.set(e.toolCallId, e.args.path);
		}
		if (e.parentToolCallId) {
			const parent = state.tasks.get(e.parentToolCallId);
			if (parent) parent.nested++;
		} else {
			state.tasks.set(e.toolCallId, {
				id: e.toolCallId,
				label: taskLabel(e.toolName, e.args),
				toolName: e.toolName,
				detail: taskDetail(e.args),
				startedAt: Date.now(),
				nested: 0,
			});
		}
		refresh();
	});

	let turnEdits: { path: string; adds: number; dels: number }[] = [];
	let turnCalls: ToolCallRecord[] = [];

	// Extract usage from tool_result events (not tool_execution_end)
	pi.on("tool_result", (e: any) => {
		if (typeof e.usage?.input === "number" || typeof e.usage?.output === "number") {
			registry.update(e.toolCallId, {
				usage: { input: e.usage.input || 0, output: e.usage.output || 0 },
			});
			const seen = turnCalls.find((c) => c.callId === e.toolCallId);
			if (seen) seen.usage = { input: e.usage.input || 0, output: e.usage.output || 0 };
		}
	});

	pi.on("tool_execution_end", (e: any, ctx) => {
		const patch = {
			status: (e.isError ? "error" : "ok") as "error" | "ok",
			durationMs: typeof e.durationMs === "number" ? e.durationMs : undefined,
		};
		registry.update(e.toolCallId, patch);
		const seen = turnCalls.find((c) => c.callId === e.toolCallId);
		if (seen) {
			seen.status = patch.status;
			seen.durationMs = patch.durationMs;
		}
		state.tasks.delete(e.toolCallId);
		if (!e.parentToolCallId) {
			if (e.isError) {
				const first = textOf(e.result).split("\n").find((l: string) => l.trim()) ?? "error";
				pushPoint("error", `${e.toolName}: ${first}`);
				appendPill(pi, "error", `${e.toolName}: ${truncateToWidth(first, 80)}`);
			} else if (e.toolName === "edit" || e.toolName === "write") {
				const path = pathByCallId.get(e.toolCallId);
				if (path) {
					const { adds, dels } = diffStats(e?.result?.details?.diff);
					turnEdits.push({ path, adds, dels: e.toolName === "write" ? dels || adds : dels });
				}
			}
		}
		pathByCallId.delete(e.toolCallId);
		refresh();
		paintStatus(ctx);
	});

	// folding: a boundary's own tool calls render while its message streams,
	// before message_end — the mark lets noteBoundary pull them into its group
	let messageMark = registry.mark();
	pi.on("message_start", (e: any) => {
		if (e.message?.role === "assistant") messageMark = registry.mark();
	});

	// streaming phase indicator (thinking -> writing)
	let currentPhase: string | undefined;
	pi.on("message_update", (e: any, ctx) => {
		if (!ctx.hasUI || !cfg.workingMessage) return;
		const ev = e.assistantMessageEvent;
		if (!ev?.type) return;
		let phase: string | undefined;
		if (ev.type.startsWith("thinking")) phase = `🧠 ${t().phaseThinking}`;
		else if (ev.type.startsWith("text")) phase = `✍ ${t().phaseWriting}`;
		if (phase && phase !== currentPhase) {
			currentPhase = phase;
			ctx.ui.setWorkingMessage(phase);
		}
	});

	let allDoneAnnounced = false;

	pi.on("message_end", (e: any, ctx) => {
		const msg = e.message;
		if (msg?.role !== "assistant") return;
		// folding: visible text separates groups; tool-only steps fold in
		const role = classifyAssistant(msg);
		if (role === "boundary") registry.noteBoundary(messageMark);
		else if (role === "carrier") registry.noteCarrier();
		// Accumulate token usage from assistant message to the current turn
		if (msg.usage && typeof msg.usage.input === "number") {
			registry.noteUsage(msg.usage.input || 0, msg.usage.output || 0);
		}
		const text = textOf(msg);
		const steps = parsePlanSteps(text);
		if (steps.length > 0) {
			state.plan = steps.map((x) => ({ text: x, done: false }));
			allDoneAnnounced = false;
		}
		let changed = false;
		for (const m of text.matchAll(/\[DONE:(\d+)\]/g)) {
			const i = parseInt(m[1], 10) - 1;
			if (state.plan[i] && !state.plan[i].done) {
				state.plan[i].done = true;
				changed = true;
			}
		}
		if (state.plan.length > 0 && !allDoneAnnounced && state.plan.every((s) => s.done)) {
			allDoneAnnounced = true;
			pushPoint("milestone", t().allDone);
			appendPill(pi, "milestone", t().allDone);
			changed = true;
		}
		if (changed || steps.length > 0) {
			refresh();
			paintStatus(ctx);
		}
	});

	pi.on("turn_start", (_e, ctx) => {
		turnEdits = [];
		turnCalls = [];
		registry.resetUsage();
		currentPhase = undefined;
		paintStatus(ctx);
	});

	pi.on("turn_end", (_e, ctx) => {
		currentPhase = undefined;
		if (ctx.hasUI) ctx.ui.setWorkingMessage();
		// folding: seal the group window; its summary lands in the key-point feed
		registry.seal();
		const summary = registry.attachUsage(buildSummary(turnCalls));
		// Attach accumulated token usage from assistant messages to the summary
		if (summary.count >= 2 || summary.failed > 0) {
			// Historical key point: use the first frame (a rotating glyph would imply
			// this settled record is still live).
			pushPoint(summary.failed > 0 ? "error" : "milestone", fmtSummaryLine(summary, 0, plainTheme, cfg.style, cfg.style.spinner[0]));
		}
		turnCalls = [];
		// turn-diff auto pill (pi-tidy /diff idea, stamped automatically)
		if (turnEdits.length > 0) {
			const files = new Set(turnEdits.map((x) => x.path)).size;
			const adds = turnEdits.reduce((s, x) => s + x.adds, 0);
			const dels = turnEdits.reduce((s, x) => s + x.dels, 0);
			const text = t().turnChanges(files, adds, dels);
			pushPoint("milestone", text);
			appendPill(pi, "milestone", text);
			turnEdits = [];
		}
		refresh();
		paintStatus(ctx);
	});

	pi.on("session_start", (_e, ctx) => {
		// runtime is live now — official settings read (project overrides merge in)
		readConfig(pi);
		registry.setAutoRow(cfg.autoRow);
		registry.setDefaultExpand(cfg.defaultExpand);
		lang = cfg.lang;
		// folding survives restore: seed the registry from the active branch
		try {
			const branch = ctx.sessionManager?.getBranch?.() ?? [];
			rebuildFromEntries(registry, branch as EntryLike[]);
		} catch {
			// no session manager / odd branch — folding just starts fresh
		}
		if (!ctx.hasUI) return;
		ctx.ui.setHiddenThinkingLabel("🧠 thinking…");
		if (!reasoningInjected && !degradeNotified) {
			degradeNotified = true;
			ctx.ui.notify("pi-helm: tool definitions owned elsewhere — render-only mode (no reasoning head)", "warning");
		}
		// HUD: mounted only in the interactive TUI (RPC/JSON/print have no
		// widgets); `hudEnabled` off means the interface is left untouched.
		syncHud(ctx);
		paintStatus(ctx);
	});

	pi.on("session_shutdown", (_e, ctx) => {
		// Idempotent: a second shutdown (or a session without widgets) must not throw.
		try {
			clearHud(ctx);
		} catch {
			// UI already torn down — nothing to release
		}
		disposeAllRenderers();
		pathByCallId.clear();
	});

	// ===== commands ==========================================================

	pi.registerCommand("milestone", {
		description: "记录一个里程碑药丸卡（不发送给 LLM）",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text) {
				ctx.ui.notify("usage: /milestone <text>", "warning");
				return;
			}
			pushPoint("milestone", text);
			appendPill(pi, "milestone", text);
			refresh();
			paintStatus(ctx);
			ctx.ui.notify(t().milestoneRecorded, "info");
		},
	});

	pi.registerCommand("lang", {
		description: T.zh.langCmd,
		handler: async (args, ctx) => {
			const v = args.trim();
			if (v === "zh" || v === "en") {
				lang = v;
				setLang(v); // rows/summaries follow the panel language
				ctx.ui.notify(t().langSwitched, "info");
			} else {
				ctx.ui.notify(`lang: ${lang} (usage: /lang zh|en)`, "info");
			}
			refresh();
			paintStatus(ctx);
		},
	});

	pi.registerCommand("demo-seed", {
		description: T.zh.seedCmd,
		handler: async (_args, ctx) => {
			state.plan = [
				{ text: "Scaffold the project", done: true },
				{ text: "Design the data model", done: true },
				{ text: "Implement the API layer", done: false },
				{ text: "Add unit tests", done: false },
				{ text: "Write documentation", done: false },
			];
			state.tasks.clear();
			state.tasks.set("fake-1", { id: "fake-1", label: "bash  npm test", toolName: "bash", detail: "npm test", startedAt: Date.now(), nested: 2 });
			state.tasks.set("fake-2", { id: "fake-2", label: "agent  scout", toolName: "agent", detail: "scout", startedAt: Date.now(), nested: 0 });
			state.points = [
				{ kind: "milestone", text: "Data model finished", ts: Date.now() - 120_000 },
				{ kind: "error", text: "bash: Cannot find module 'zod'", ts: Date.now() },
			];
			allDoneAnnounced = false;
			refresh();
			paintStatus(ctx);
			ctx.ui.notify(t().seedDone, "info");
			setTimeout(() => {
				state.tasks.clear();
				refresh();
				paintStatus(ctx);
			}, 10_000);
		},
	});

	pi.registerCommand("demo-clear", {
		description: T.zh.clearCmd,
		handler: async (_args, ctx) => {
			state.plan = [];
			state.tasks.clear();
			state.points = [];
			refresh();
			paintStatus(ctx);
			ctx.ui.notify(t().cleared, "info");
		},
	});
}
