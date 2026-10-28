/**
 * pi-helm group folding — pure state machine.
 *
 * Zero pi imports, zero theme, zero side effects: node --test runs this file
 * directly. The renderer layer (renderers.ts) and the wiring (index.ts) sit on
 * top of this.
 *
 * Semantics absorbed from pi-tidy (MIT, Andy8647/pi-tidy) — boundary/carrier
 * classification, the 1s anti-flicker delay, failure count on the summary,
 * edit/write never folding — expressed afresh as an instance-based registry
 * (no module globals, so multi-session / reload races cannot happen).
 */

/** How long a running call stays hidden before its row surfaces. */
export const RUNNING_ROW_DELAY_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Assistant message roles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - `boundary`: has visible text → separates groups (text always renders)
 * - `carrier`:  only thinking + tool calls → folds into the current group
 * - `plain`:    anything else (truncation notice, thinking-only, error) →
 *               renders as usual, leaves grouping alone
 */
export type AssistantRole = "boundary" | "carrier" | "plain";

export interface AssistantMessageLike {
	content?: unknown;
	stopReason?: unknown;
}

/** Pure: how an assistant message participates in folding. Never hides text. */
export function classifyAssistant(message: AssistantMessageLike | undefined): AssistantRole {
	// Unknown shape (pi changed the field): keep the old behaviour, never hide.
	if (!message || !Array.isArray(message.content)) return "boundary";
	let hasToolCall = false;
	for (const block of message.content as Array<{ type?: unknown; text?: unknown }>) {
		if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) return "boundary";
		if (block?.type === "toolCall") hasToolCall = true;
	}
	// A length stop renders "Response was truncated" — never fold that away.
	if (hasToolCall && message.stopReason !== "length") return "carrier";
	return "plain";
}

// ─────────────────────────────────────────────────────────────────────────────
// Records
// ─────────────────────────────────────────────────────────────────────────────

export type ToolStatus = "running" | "ok" | "error";

/** Token usage from a completed tool call (official ToolResultEvent.usage). */
export interface ToolUsage {
	input: number;
	output: number;
	cacheRead?: number;
}

export interface ToolCallRecord {
	callId: string;
	toolName: string;
	status: ToolStatus;
	/** Epoch ms; the anti-flicker delay measures from here. */
	startedAt?: number;
	durationMs?: number;
	/** Token usage set at tool_execution_end when the provider reports it. */
	usage?: ToolUsage;
}

export interface GroupMember extends ToolCallRecord {
	/** This member's full box is open (level 2). */
	expanded: boolean;
}

export interface BreakdownEntry {
	name: string;
	count: number;
}

export interface GroupSummary {
	count: number;
	/** Per-tool counts, most frequent first, ties alphabetical. */
	breakdown: BreakdownEntry[];
	/** Members that finished with an error (sticky on the summary). */
	failed: number;
	/** Members still running (feeds the dashboard footer/panel). */
	running: number;
	/** Sum of the durations that are known. */
	durationMs: number;
	/** Aggregated token usage across members (undefined if none reported). */
	usage?: { input: number; output: number };
}

/** Pure: what the summary line says. */
export function buildSummary(members: readonly ToolCallRecord[]): GroupSummary {
	const counts = new Map<string, number>();
	let durationMs = 0;
	let failed = 0;
	let running = 0;
	let input = 0;
	let output = 0;
	let hasUsage = false;
	for (const member of members) {
		if (member.status === "error") failed++;
		if (member.status === "running") running++;
		counts.set(member.toolName, (counts.get(member.toolName) ?? 0) + 1);
		if (typeof member.durationMs === "number" && Number.isFinite(member.durationMs)) {
			durationMs += member.durationMs;
		}
		if (member.usage) {
			hasUsage = true;
			input += member.usage.input || 0;
			output += member.usage.output || 0;
		}
	}
	const breakdown = [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	return {
		count: members.length,
		breakdown,
		failed,
		running,
		durationMs,
		...(hasUsage ? { usage: { input, output } } : {}),
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// View plan
// ─────────────────────────────────────────────────────────────────────────────

/** What a call's component draws this frame, top to bottom. */
export interface ViewPlan {
	/** The group's summary line, carried by its first member: `▸` folded, `▾` open. */
	header: "closed" | "open" | null;
	/** The one-row view of this call. */
	line: boolean;
	/** The full content (level 2). */
	full: boolean;
	/** Indent `line`/`full` under the group's `│` gutter. */
	gutter: boolean;
	/** Ms until a hidden running row is due to appear — schedule a repaint. */
	revealIn?: number;
}

export interface ViewPlanInput {
	/** This call is the group's first member: it carries the summary line. */
	isFirst?: boolean;
	level?: 0 | 1;
	/** Always-shown tool (edit/write): pi's own full box, nothing else. */
	pinned?: boolean;
	/**
	 * A (autoRow): this call's group has exactly one member. One call has
	 * nothing worth summarizing — `▸ 1 call · bash×1` hides what the call * * actually did, so the row itself becomes the whole view: no summary
	 * header, no gutter (nothing above to connect to), idle → row, running →
	 * live row, expanded → full box.
	 */
	solo?: boolean;
	/** The full box is open for this member (level 2). */
	expanded?: boolean;
	/** Ms this call has been running, or undefined when nothing runs. */
	runningAgeMs?: number;
}

/** Pure: how long a member has been hidden-worthy, from the clock. */
export function viewPlan(input: ViewPlanInput): ViewPlan {
	const { isFirst = false, level = 0, pinned = false, solo = false, expanded = false, runningAgeMs } = input;
	if (pinned) return { header: null, line: false, full: true, gutter: false };
	// A (autoRow): a one-call group skips the summary entirely — the row is
	// the view. No anti-flicker delay here: there is no summary above for a
	// row to pop out from under, and a second call joining folds the row into
	// a real summary (a genuine state change, not a flicker).
	if (solo) {
		return expanded
			? { header: null, line: false, full: true, gutter: false }
			: { header: null, line: true, full: false, gutter: false };
	}
	const header = isFirst ? (level === 0 ? "closed" : "open") : null;
	if (level === 0) {
		if (runningAgeMs === undefined) return { header, line: false, full: false, gutter: false };
		// A row that pops out under the summary and folds back a frame later
		// reads as a flicker: long commands surface after a second, short ones
		// never announce themselves.
		if (runningAgeMs < RUNNING_ROW_DELAY_MS) {
			return { header, line: false, full: false, gutter: false, revealIn: RUNNING_ROW_DELAY_MS - runningAgeMs };
		}
		return { header, line: true, full: false, gutter: true };
	}
	return expanded
		? { header, line: false, full: true, gutter: true }
		: { header, line: true, full: false, gutter: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────────────────────

interface Group {
	id: number;
	level: 0 | 1;
	members: GroupMember[];
	sealed: boolean;
	/** Assistant-message token usage stamped onto this group as it accumulates. */
	usage?: { input: number; output: number };
}

export interface GroupRegistryOptions {
	/** Tools that never fold and cut the group (their diff is the point). */
	pinnedTools?: readonly string[];
	/** Clock seam for tests. */
	now?: () => number;
	/** A: one-call groups show their row directly instead of a `▸ 1 call` wrapper (default true). */
	autoRow?: boolean;
}

export const DEFAULT_PINNED_TOOLS: readonly string[] = ["edit", "write"];

/**
 * One instance per session. Membership is keyed by `callId`, so a call reports
 * in exactly once however many frames render it, and the same registry can be
 * seeded from a restored branch (see rebuild in index.ts).
 */
export class GroupRegistry {
	private readonly pinnedTools: ReadonlySet<string>;
	private readonly now: () => number;
	private autoRow: boolean;
	private groups: Group[] = [];
	private current: Group;
	private byCallId = new Map<string, { group: Group; member: GroupMember }>();
	private pinnedById = new Map<string, ToolCallRecord>();
	private seqById = new Map<string, number>();
	private seq = 0;
	private nextGroupId = 1;
	private turnUsage = { input: 0, output: 0 };

	constructor(options: GroupRegistryOptions = {}) {
		this.pinnedTools = new Set(options.pinnedTools ?? DEFAULT_PINNED_TOOLS);
		this.now = options.now ?? Date.now;
		this.autoRow = options.autoRow ?? true;
		this.current = this.openGroup();
	}

	/** Settings can arrive after construction — flip A (autoRow) on the fly. */
	setAutoRow(enabled: boolean): void {
		this.autoRow = enabled;
	}

	private openGroup(): Group {
		const group: Group = { id: this.nextGroupId++, level: 0, members: [], sealed: false };
		this.groups.push(group);
		return group;
	}

	/** Report-order watermark: `noteBoundary(this.mark())` moves later joins. */
	mark(): number {
		return this.seq;
	}

	/**
	 * An assistant boundary (visible text) separates groups. Because a tool
	 * card renders while its message is still streaming, calls of the
	 * boundary's own message may have reported into the previous window
	 * already: everything reported after `mark` (captured at message_start)
	 * moves into the fresh window this boundary opens. Without a mark the
	 * call is a plain cut (rebuild path, where order is already correct).
	 * Idempotent on an empty window.
	 */
	noteBoundary(mark: number = this.seq): void {
		const late = this.current.members.filter((m) => (this.seqById.get(m.callId) ?? 0) > mark);
		if (late.length === 0 && this.current.members.length === 0 && !this.current.sealed) return;
		this.current.sealed = true;
		const next = this.openGroup();
		for (const member of late) {
			const at = this.current.members.indexOf(member);
			if (at >= 0) this.current.members.splice(at, 1);
			next.members.push(member);
			const entry = this.byCallId.get(member.callId);
			if (entry) entry.group = next;
		}
		this.current = next;
	}

	/** A carrier step: folds into the current group, never splits it. */
	noteCarrier(): void {
		// Nothing to record — carriers hold no calls of their own that are not
		// already reported. Kept as an explicit seam for the wiring layer.
	}

	/**
	 * A tool call reports in (render time). Idempotent by callId: the second
	 * report returns false and changes nothing. Pinned tools seal the group
	 * and are stored outside of it.
	 */
	report(record: ToolCallRecord): boolean {
		if (this.pinnedTools.has(record.toolName)) {
			if (this.pinnedById.has(record.callId)) return false;
			this.pinnedById.set(record.callId, { ...record });
			this.seqById.set(record.callId, ++this.seq);
			this.current.sealed = true;
			if (this.current.members.length > 0) this.current = this.openGroup();
			return true;
		}
		const known = this.byCallId.get(record.callId);
		if (known) return false;
		const member: GroupMember = { ...record, expanded: false };
		this.current.members.push(member);
		this.byCallId.set(record.callId, { group: this.current, member });
		this.seqById.set(record.callId, ++this.seq);
		return true;
	}

	/**
	 * Event-layer update (tool_execution_start/end). Upserts by callId and
	 * merges the patch — an update for a call that never reported joins the
	 * current group, so a render skipped by another extension loses nothing.
	 */
	update(callId: string, patch: Partial<Omit<ToolCallRecord, "callId">>): boolean {
		const known = this.byCallId.get(callId);
		if (known) {
			Object.assign(known.member, stripUndefined(patch));
			return true;
		}
		const pinned = this.pinnedById.get(callId);
		if (pinned) {
			Object.assign(pinned, stripUndefined(patch));
			return true;
		}
		return this.report({
			callId,
			toolName: patch.toolName ?? "tool",
			status: patch.status ?? "running",
			...stripUndefined(patch),
		});
	}

	/** Turn end: seal the window so the next turn starts a new group. */
	seal(): void {
		this.current.sealed = true;
		this.current = this.openGroup();
	}

	/** The group's members in join order, or undefined for a pinned/unknown call. */
	membersOf(callId: string): readonly GroupMember[] | undefined {
		return this.byCallId.get(callId)?.group.members;
	}

	/** Whether this call is an always-shown tool (edit/write). */
	isPinned(callId: string): boolean {
		return this.pinnedById.has(callId);
	}

	/**
	 * The raw record behind a call — group member *or* pinned. The display
	 * layer reads usage/duration from here: membersOf() returns undefined for
	 * pinned calls, which is exactly how edit/write cards lost their ↑↓ tail
	 * (3a fix).
	 */
	recordOf(callId: string): ToolCallRecord | undefined {
		return this.byCallId.get(callId)?.member ?? this.pinnedById.get(callId);
	}

	/**
	 * Accumulate assistant-message token usage. It is stamped onto the *live*
	 * group (so every sealed group keeps its own share) and, separately, onto a
	 * turn-level total used only by the turn-end key point.
	 */
	noteUsage(input: number, output: number): void {
		const cur = this.current.usage ?? (this.current.usage = { input: 0, output: 0 });
		cur.input += input;
		cur.output += output;
		this.turnUsage.input += input;
		this.turnUsage.output += output;
	}

	/** The summary of the group this call belongs to (undefined for pinned). */
	summary(callId: string): GroupSummary | undefined {
		const entry = this.byCallId.get(callId);
		if (!entry) return undefined;
		const s = buildSummary(entry.group.members);
		const u = entry.group.usage;
		if (u && (u.input > 0 || u.output > 0)) s.usage = { ...u };
		return s;
	}

	/** Attach the *turn-level* accumulated usage to a summary (mutates + returns it). */
	attachUsage(summary: GroupSummary): GroupSummary {
		if (this.turnUsage.input > 0 || this.turnUsage.output > 0) {
			summary.usage = { ...this.turnUsage };
		}
		return summary;
	}

	/** Clear the per-turn usage accumulator (call at turn boundaries). */
	resetUsage(): void {
		this.turnUsage = { input: 0, output: 0 };
	}

	/** What this call's component draws this frame. */
	planFor(callId: string): ViewPlan | undefined {
		if (this.pinnedById.has(callId)) return viewPlan({ pinned: true });
		const entry = this.byCallId.get(callId);
		if (!entry) return undefined;
		const { group, member } = entry;
		return viewPlan({
			isFirst: group.members[0] === member,
			level: group.level,
			solo: this.autoRow && group.members.length === 1,
			expanded: member.expanded,
			runningAgeMs: this.runningAge(member),
		});
	}

	private runningAge(member: GroupMember): number | undefined {
		if (member.status !== "running") return undefined;
		return Math.max(0, this.now() - (member.startedAt ?? this.now()));
	}

	/** Header click: the group folds (0) and unfolds (1) as one. */
	toggleHeader(callId: string): void {
		const group = this.byCallId.get(callId)?.group;
		if (!group) return;
		if (group.level === 0) {
			group.level = 1;
			return;
		}
		group.level = 0;
		for (const member of group.members) member.expanded = false;
	}

	/** Row click: that member opens its full content (level 2). */
	rowClick(callId: string): void {
		const entry = this.byCallId.get(callId);
		if (!entry) return;
		entry.group.level = 1;
		entry.member.expanded = true;
	}

	/**
	 * pi's own expand flag, translated into levels: ctrl+o's expand-all opens
	 * the group, ctrl+o's collapse-all returns it to the summary line, and a
	 * pointer click on a full box folds just that box back into its row.
	 */
	noteSetExpanded(callId: string, expanded: boolean, fromPointer: boolean): void {
		const entry = this.byCallId.get(callId);
		if (!entry) return;
		const { group, member } = entry;
		if (expanded) {
			group.level = 1;
			member.expanded = true;
			return;
		}
		if (fromPointer) {
			member.expanded = false;
			return;
		}
		group.level = 0;
		for (const m of group.members) m.expanded = false;
	}
}

function stripUndefined<T extends object>(patch: T): Partial<T> {
	const out: Partial<T> = {};
	for (const [key, value] of Object.entries(patch) as Array<[keyof T, T[keyof T]]>) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session restore
// ─────────────────────────────────────────────────────────────────────────────

/** Shaped like pi's SessionMessageEntry; we only read `type` and `message`. */
export interface EntryLike {
	type?: unknown;
	message?: unknown;
}

interface RestoredMessage {
	role?: unknown;
	content?: unknown;
	stopReason?: unknown;
	toolCallId?: unknown;
	toolName?: unknown;
	isError?: unknown;
	durationMs?: unknown;
}

/**
 * Seed a registry from a restored branch (`ctx.sessionManager.getBranch()`).
 * Assistant entries classify into boundary/carrier; the tool calls of a
 * message join at that message's position; tool results settle their call.
 * Pure and shape-defensive: anything unexpected is skipped, never thrown on.
 *
 * A call that never got a result (interrupted session) stays `running` —
 * that is what it was; the summary carries it honestly.
 */
export function rebuildFromEntries(registry: GroupRegistry, entries: readonly EntryLike[]): void {
	for (const entry of entries) {
		if (entry?.type !== "message") continue;
		const message = entry.message as RestoredMessage | undefined;
		if (!message || typeof message !== "object") continue;
		if (message.role === "assistant") {
			const role = classifyAssistant(message as AssistantMessageLike);
			if (role === "boundary") registry.noteBoundary();
			else if (role === "carrier") registry.noteCarrier();
			if (Array.isArray(message.content)) {
				for (const block of message.content as Array<{ type?: unknown; id?: unknown; name?: unknown }>) {
					if (block?.type === "toolCall" && typeof block.id === "string") {
						registry.report({
							callId: block.id,
							toolName: typeof block.name === "string" ? block.name : "tool",
							status: "running",
						});
					}
				}
			}
			continue;
		}
		if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			const patch = {
				status: (message.isError === true ? "error" : "ok") as "error" | "ok",
				durationMs: typeof message.durationMs === "number" ? message.durationMs : undefined,
			};
			registry.report({
				callId: message.toolCallId,
				toolName: typeof message.toolName === "string" ? message.toolName : "tool",
				status: patch.status,
				durationMs: patch.durationMs,
			});
			registry.update(message.toolCallId, patch);
		}
	}
	registry.seal();
}
