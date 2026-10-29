/**
 * pi-helm display style — glyphs, separators, tool icons.
 *
 * One built-in style (the classic pi-helm look); users layer DIY overrides
 * on top via settings.json without losing the default:
 *
 *   "pi-helm": { "style": { "marker": "❯", "icons": { "bash": "▸" } } }
 *
 * Pure (zero pi imports): renderers.ts and node --test consume it directly.
 * Colors are NOT part of Style — they stay pi semantic theme tokens
 * (accent/dim/error/success/warning) so dark/light themes keep working
 * (No-Fight contract: no hardcoded color values).
 */

import { stringWidth } from "./width.ts";

export interface Style {
	/** Folded group header marker: `▸`. */
	marker: string;
	/** Open group header marker: `▾`. */
	openMarker: string;
	/** Row gutter under a group: `└`. */
	rowGutter: string;
	/** Segment separator: `·`. */
	sep: string;
	/** Per-tool icon for the summary breakdown and pinned cards. */
	icons: Record<string, string>;
	/**
	 * Animation frames for the running indicator: braille dots by default.
	 * Every frame must be one display cell wide (tmux/SSH safe); the renderer
	 * derives the frame from the clock — `frames[floor(now / 180) % len]` —
	 * so nothing extra is stored and tests can pin `now`.
	 */
	spinner: readonly string[];
}

/**
 * Braille spinner: 10 single-width frames, the classic safe choice. Terminals
 * without braille still get one cell (no layout shift), just a less pretty one.
 */
export const DEFAULT_SPINNER: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** ms per spinner frame (~5.6fps: soft enough to read, alive enough to signal work). */
export const SPINNER_FRAME_MS = 180;

/**
 * Pure: which spinner frame belongs to an instant. Time-derived (no state), so
 * two call sites rendering the same frame agree and tests stay deterministic.
 */
export function spinnerFrame(nowMs: number, frames: readonly string[] = DEFAULT_SPINNER): string {
	const list = frames.length > 0 ? frames : DEFAULT_SPINNER;
	const index = Math.floor(nowMs / SPINNER_FRAME_MS) % list.length;
	return list[(index + list.length) % list.length];
}

/**
 * Summary/pinned tool icons. Widening note: keep every icon two display cells
 * wide — the summary breakdown and panel borders assume it (a test guards it).
 */
export const TOOL_ICONS: Record<string, string> = {
	read: "📖",
	bash: "⚡",
	edit: "✏️",
	write: "📝",
	grep: "🔎",
	find: "🗂",
	ls: "📂",
	web_search: "🌐",
	workflow: "🔀",
	/** Prefix rule: every `mcp__*` tool shares this icon. */
	mcp: "🔌",
	intercom: "💬",
	/** Fallback for anything else (DIY can override this key). */
	"*": "🤖",
};

/**
 * Pure: how many `─` fill a panel rule so the closing corner lands on the same
 * column as the other rules. Counts **display cells** (`🤖` is 2 UTF-16 units
 * *and* 2 cells — a coincidence the old `.length` math relied on; a ZWJ or a
 * single-width glyph would have bent the box).
 */
export function panelRuleDashes(label: string, inner: number): number {
	// `┌─ ` + label + ` ` + dashes + corner === inner + 3 cells wide
	return Math.max(0, inner - stringWidth(label) - 2);
}

/**
 * Pure: the icon for a tool name. Exact match → MCP prefix → fallback.
 * Reads the *given* icon table, so settings.json `style.icons` overrides
 * (including `mcp` and `*`) take effect everywhere.
 */
export function iconFor(toolName: string, icons: Record<string, string> = TOOL_ICONS): string {
	const exact = icons[toolName];
	if (exact) return exact;
	if (toolName.startsWith("mcp__") || toolName.startsWith("mcp")) return icons.mcp ?? "🔌";
	return icons["*"] ?? "🤖";
}

export const DEFAULT_STYLE: Style = {
	marker: "▸",
	openMarker: "▾",
	rowGutter: "└",
	sep: "·",
	icons: TOOL_ICONS,
	spinner: DEFAULT_SPINNER,
};

/**
 * Merge a settings.json `style` override onto the built-in default.
 * Empty strings are ignored (a typo must not blank the UI); `icons` merges
 * per-key so a custom entry never drops the other defaults.
 */
export function mergeStyle(override: Partial<Style> | undefined | null): Style {
	if (!override || typeof override !== "object") return DEFAULT_STYLE;
	const str = (v: unknown, fallback: string): string =>
		typeof v === "string" && v.length > 0 ? v : fallback;
	const icons = { ...DEFAULT_STYLE.icons };
	if (override.icons && typeof override.icons === "object") {
		for (const [key, value] of Object.entries(override.icons)) {
			if (typeof value === "string" && value.length > 0) icons[key] = value;
		}
	}
	// A DIY spinner must be a non-empty list of non-empty strings; anything
	// malformed keeps the built-in braille set (a typo must not blank the UI).
	const spinner =
		Array.isArray(override.spinner) && override.spinner.length > 0 && override.spinner.every((f) => typeof f === "string" && f.length > 0)
			? [...override.spinner]
			: DEFAULT_STYLE.spinner;
	return {
		marker: str(override.marker, DEFAULT_STYLE.marker),
		openMarker: str(override.openMarker, DEFAULT_STYLE.openMarker),
		rowGutter: str(override.rowGutter, DEFAULT_STYLE.rowGutter),
		sep: str(override.sep, DEFAULT_STYLE.sep),
		icons,
		spinner,
	};
}
