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
}

/** Emoji Presentation set the classic look ships with (also used by pinned cards). */
export const TOOL_ICONS: Record<string, string> = {
	read: "📖",
	bash: "⚡",
	edit: "✏️",
	write: "📝",
	grep: "🔎",
	find: "🗂",
	ls: "📂",
};

export const DEFAULT_STYLE: Style = {
	marker: "▸",
	openMarker: "▾",
	rowGutter: "└",
	sep: "·",
	icons: TOOL_ICONS,
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
	return {
		marker: str(override.marker, DEFAULT_STYLE.marker),
		openMarker: str(override.openMarker, DEFAULT_STYLE.openMarker),
		rowGutter: str(override.rowGutter, DEFAULT_STYLE.rowGutter),
		sep: str(override.sep, DEFAULT_STYLE.sep),
		icons,
	};
}
