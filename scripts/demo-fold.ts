/**
 * Visual check — prints every folding state through the REAL state machine,
 * formatters and resolver chain in src/ (no mocks, no hand-drawn formatting,
 * so the output always follows the code).
 *
 *   node --experimental-strip-types scripts/demo-fold.ts            # colored
 *   node --experimental-strip-types scripts/demo-fold.ts --plain     # plain text
 *
 * The fixed clock (`NOW`) keeps the spinner frame and every duration stable,
 * so the output is reproducible and safe to embed in the README.
 */
import { DEFAULT_PINNED_BODY_HEIGHT, createToolResolver, disposeAllRenderers, fmtSummaryLine, type ThemeLike } from "../src/renderers.ts";
import { GroupRegistry } from "../src/groups.ts";
import { setLang } from "../src/strings.ts";
import { DEFAULT_STYLE, spinnerFrame } from "../src/styles.ts";

const PLAIN = process.argv.includes("--plain");
const WIDTH = 100;
/** One instant for the whole run: deterministic spinner frame, stable output. */
const NOW = 100_000;

// ── theme ────────────────────────────────────────────────────────────────────
const ansi = (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const c = {
	accent: ansi(36),
	success: ansi(32),
	error: ansi(31),
	warning: ansi(33),
	dim: ansi(90),
	toolOutput: ansi(37),
	bold: ansi(1),
};
const plain = (s: string) => s;
const theme: ThemeLike = PLAIN
	? { fg: (_color, text) => text, bold: plain }
	: {
			fg: (color, text) => (c as Record<string, (s: string) => string>)[color]?.(text) ?? text,
			bold: c.bold,
		};

const under = (s: string) => (PLAIN ? `== ${s} ==` : `\x1b[7m ${s} \x1b[0m`);
function rule(title: string): void {
	console.log(`\n${under(title)}`);
}

// ── rig: the real registry + the real resolver chain ─────────────────────────
interface Spec {
	id: string;
	tool: string;
	args: unknown;
	result?: unknown;
	durationMs?: number;
	usage?: { input: number; output: number };
	isError?: boolean;
}

function rig(options: { autoRow?: boolean; defaultExpand?: boolean } = {}) {
	const registry = new GroupRegistry({ now: () => NOW, ...options });
	const resolver = createToolResolver({ registry, enabled: () => true, now: () => NOW });
	return { registry, resolver: resolver as any };
}

/**
 * Feed calls through the real renderer exactly like a live session does:
 * renderCall while streaming, renderResult once settled. Components are kept
 * so later state changes (open, expand, collapse) can be repainted.
 */
function build(r: ReturnType<typeof rig>, specs: Spec[]) {
	const comps = specs.map((spec) => {
		const mine = r.resolver(spec.tool, () => undefined);
		const ctx = { toolCallId: spec.id, args: spec.args, isPartial: true, expanded: false, invalidate: () => {} };
		mine.renderCall(spec.args, theme, ctx);
		if (spec.usage) r.registry.update(spec.id, { usage: spec.usage }); // tool_result event
		const settled = {
			toolCallId: spec.id,
			args: spec.args,
			isPartial: false,
			isError: spec.isError === true,
			durationMs: spec.durationMs,
			invalidate: () => {},
		};
		return mine.renderResult(spec.result ?? { content: [] }, { expanded: false, isPartial: false }, theme, settled);
	});
	const repaint = (width = WIDTH) => {
		for (const comp of comps) for (const line of comp.render(width)) console.log(line);
	};
	return { comps, repaint };
}

/** A running call: only renderCall, so the live clock and spinner stay active. */
function buildRunning(r: ReturnType<typeof rig>, spec: Spec) {
	const mine = r.resolver(spec.tool, () => undefined);
	const ctx = { toolCallId: spec.id, args: spec.args, isPartial: true, expanded: false, invalidate: () => {} };
	const comp = mine.renderCall(spec.args, theme, ctx);
	return () => {
		for (const line of comp.render(WIDTH)) console.log(line);
	};
}

const out = (text: string) => console.log(PLAIN ? `  ${text}` : `  ${c.dim(text)}`);
const text = (s: string) => ({ content: [{ type: "text", text: s }] });

// ═════════════════════════════════════════════════════════════════════════════
rule("[1] Folded group (level 0) — three tool calls between two replies");
{
	const r = rig();
	const scene = build(r, [
		{ id: "c1", tool: "bash", args: { command: "git status --short", reasoning: "check the working tree" }, result: text("M src/app.ts\nM README.md\n?? tmp/\n?? notes.md"), durationMs: 100 },
		{ id: "c2", tool: "read", args: { path: "src/app.ts", reasoning: "see what changed" }, result: text("x".repeat(0) + Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n")), durationMs: 30 },
		{ id: "c3", tool: "bash", args: { command: "pnpm test", reasoning: "run the tests" }, result: text("FAIL test/app.test.ts\nAssertionError: expected 1 to be 2"), durationMs: 1800, isError: true, usage: { input: 1200, output: 169 } },
	]);
	scene.repaint();
	out("← one line: counts, icons, failure count, token usage, duration");

	rule("[2] Click the summary (level 1) — one row per call, │ gutter");
	r.registry.toggleHeader("c1");
	scene.repaint();
	out("← ✓/✗ state, reason phrase, target, outcome, usage, duration per row");

	rule("[3] Click a row (level 2) — that call's full output");
	r.registry.rowClick("c3");
	scene.repaint();

	rule("[4] Ctrl+O collapse-all — back to the summary line");
	r.registry.noteSetExpanded("c3", false, false);
	scene.repaint();
}

// ═════════════════════════════════════════════════════════════════════════════
rule("[5] edit/write never fold — the diff is the point, and it cuts the group");
{
	const r = rig();
	build(r, [
		{ id: "e1", tool: "edit", args: { path: "src/app.ts" }, result: { content: [], details: { diff: "@@ -10,3 +10,3 @@\n- const x = 1;\n+ const x = 2;\n // untouched" } }, durationMs: 300, usage: { input: 800, output: 40 } },
	]).repaint();
	out("← header carries the diff stat, usage and duration; the body is the diff itself");
}

rule("[6] Long diff — fixed viewport, ▲/▼ indicators, total line count in the header");
{
	const r = rig();
	const diff = ["@@ -1,30 +1,30 @@", ...Array.from({ length: 30 }, (_, i) => `+ added line ${i + 1}`)];
	build(r, [
		{ id: "e2", tool: "write", args: { path: "src/big.ts" }, result: { content: [], details: { diff: diff.join("\n") } }, durationMs: 420, usage: { input: 2400, output: 310 } },
	]).repaint();
	out(`← viewport capped at pinnedBodyHeight (default ${DEFAULT_PINNED_BODY_HEIGHT}); the wheel scrolls it`);
}

// ═════════════════════════════════════════════════════════════════════════════
rule("[7] Anti-flicker — a call under 1s stays hidden; from 1s it surfaces with a live clock");
{
	const r = rig();
	const fresh = buildRunning(r, { id: "r1", tool: "bash", args: { command: "sleep 30", reasoning: "wait for the build" } });
	const stale = buildRunning(r, { id: "r2", tool: "bash", args: { command: "pnpm build", reasoning: "rebuild the bundle" } });
	// r2 started 1.5s ago, r1 only 0.5s ago (NOW is fixed, so this is reproducible)
	r.registry.update("r2", { startedAt: NOW - 1500 });
	r.registry.update("r1", { startedAt: NOW - 500 });
	fresh();
	stale();
	out("← only the call over 1s appears; the short one is hidden on purpose");
}

rule("[8] Running spinner — the frame comes from the clock, not from state");
{
	const frames = ["0ms", "180ms", "360ms", "540ms", "720ms"]
		.map((label, i) => `${spinnerFrame(NOW + i * 180)} @ ${label}`)
		.join("   ");
	console.log(PLAIN ? `  ${frames}` : `  ${c.warning(frames)}`);
	out("← 180ms per frame, braille, single width (tmux/SSH safe)");
}

// ═════════════════════════════════════════════════════════════════════════════
rule("[9] autoRow — a single call shows its row directly, no ▸ 1 call wrapper");
{
	const r = rig();
	build(r, [
		{ id: "s1", tool: "read", args: { path: "src/index.ts", reasoning: "read the entry point" }, result: text(Array.from({ length: 42 }, (_, i) => `line ${i + 1}`).join("\n")), durationMs: 60 },
	]).repaint();
	out("← one call = nothing worth summarizing; the row IS the view");
}

rule("[10] defaultExpand — a new group opens at level 1 without a click");
{
	const r = rig({ defaultExpand: true });
	build(r, [
		{ id: "d1", tool: "grep", args: { pattern: "TODO", reasoning: "find leftovers" }, result: text("a.ts:1\nb.ts:9"), durationMs: 20 },
		{ id: "d2", tool: "ls", args: { path: "src", reasoning: "list the sources" }, result: text("a.ts\nb.ts\nc.ts"), durationMs: 10 },
	]).repaint();
	out("← ▾ header + one row per call, straight away");
}

// ═════════════════════════════════════════════════════════════════════════════
rule("[11] Iconized summary — known tools get icons, MCP shares one, unknowns fall back");
{
	const r = rig({ autoRow: false });
	build(r, [
		{ id: "i1", tool: "web_search", args: { query: "pi tui" }, result: text("3 results"), durationMs: 900 },
		{ id: "i2", tool: "workflow", args: { name: "audit" }, result: text("done"), durationMs: 1200 },
		{ id: "i3", tool: "mcp__github__search", args: { query: "x" }, result: text("2 hits"), durationMs: 300 },
		{ id: "i5", tool: "my_custom_tool", args: { thing: 1 }, result: text("ok"), durationMs: 100 },
	]).repaint();
	out("← icons come from the icon table (mcp prefix → 🔌, unknown → 🤖)");
}

// ═════════════════════════════════════════════════════════════════════════════
rule("[12] Bilingual word tables — the same summary in zh and en");
{
	const r = rig({ autoRow: false });
	build(r, [
		{ id: "z1", tool: "bash", args: { command: "pnpm test" }, result: text("ok"), durationMs: 800 },
		{ id: "z2", tool: "read", args: { path: "a.ts" }, result: text("1\n2"), durationMs: 40 },
	]);
	const summary = r.registry.summary("z1")!;
	const frame = spinnerFrame(NOW, DEFAULT_STYLE.spinner);
	for (const lang of ["zh", "en"] as const) {
		setLang(lang);
		console.log(`  ${lang}: ${fmtSummaryLine(summary, 0, theme, DEFAULT_STYLE, frame)}`);
	}
	setLang("en"); // leave the module as we found it
	out("← same data, two vocabularies; /lang switches live");
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(
	PLAIN
		? "\nEvery line above came from the real formatters and state machine in src/."
		: `\n${c.dim("Every line above came from the real formatters and state machine in src/.")}`,
);
disposeAllRenderers(); // no timers left behind
