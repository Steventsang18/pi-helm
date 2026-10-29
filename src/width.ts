/**
 * pi-helm display-width utilities — pure, zero pi imports, zero side effects.
 *
 * Emoji/CJK occupy two terminal cells; counting UTF-16 units (the obvious but
 * wrong way) misaligns every border and row that mixes them. Both the renderer
 * (line clipping) and the style layer (panel border math) need this, so it
 * lives in its own module instead of inside renderers.ts — otherwise
 * styles.ts → renderers.ts → styles.ts would form a cycle.
 */

/** Emoji_Presentation code points inside otherwise narrow blocks (U+26A1 and friends). */
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
export function cellWidth(cp: number): number {
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
export function clipToWidth(text: string, width: number): string {
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
