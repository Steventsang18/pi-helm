/**
 * Global visual check — prints every folding state through the REAL formatter
 * and state-machine functions in src/ (no mocks). Run:  node scripts/demo-fold.ts
 */
import { fmtSummaryLine, fmtRow, fmtPinned, type ThemeLike } from "../src/renderers.ts";
import { GroupRegistry, RUNNING_ROW_DELAY_MS, type ToolCallRecord } from "../src/groups.ts";

// a tiny ANSI "theme" so the output looks like the TUI
const c = {
	accent: (s: string) => `\x1b[36m${s}\x1b[0m`,
	success: (s: string) => `\x1b[32m${s}\x1b[0m`,
	error: (s: string) => `\x1b[31m${s}\x1b[0m`,
	warning: (s: string) => `\x1b[33m${s}\x1b[0m`,
	dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
	toolOutput: (s: string) => `\x1b[37m${s}\x1b[0m`,
};
const theme: ThemeLike = {
	fg: (color: string, text: string) => (c as any)[color]?.(text) ?? text,
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

function rule(title: string) {
	console.log(`\n\x1b[7m ${title} \x1b[0m`);
}

/** Replay exactly what the renderer draws for each call of a group. */
function drawGroup(registry: GroupRegistry, callIds: string[], bodies: Record<string, string[]> = {}) {
	for (const id of callIds) {
		const plan = registry.planFor(id)!;
		const member = registry.membersOf(id)!.find((m) => m.callId === id)!;
		const row = (gutter: boolean) =>
			fmtRow(
				{
					status: member.status,
					toolName: member.toolName,
					reasoning: REASONING[id],
					detail: DETAIL[id],
					outcome: OUTCOME[id],
					durationMs: member.durationMs,
				},
				theme,
				gutter,
			);
		if (plan.header) {
			console.log(fmtSummaryLine(registry.summary(id)!, plan.header === "closed" ? 0 : 1, theme));
		}
		if (plan.full) {
			console.log(row(true));
			for (const line of bodies[id] ?? []) console.log(c.toolOutput(`  ${line}`));
		} else if (plan.line) {
			console.log(row(true));
		} else if (plan.revealIn !== undefined) {
			console.log(c.dim(`  (running <1s — hidden for ${plan.revealIn}ms, anti-flicker)`));
		}
	}
}

const REASONING: Record<string, string> = {
	c1: "确认哪个断言挂了",
	c2: "看一眼改动",
	c3: "跑测试",
};
const DETAIL: Record<string, string> = {
	c1: "git status --short",
	c2: "src/app.ts",
	c3: "pnpm test",
	e1: "~/src/app.ts",
	r1: "sleep 30",
	r2: "pnpm build",
};
const OUTCOME: Record<string, string> = {
	c1: "4 lines",
	c2: "120 lines",
	c3: "exit 1",
	e1: "+12/−3",
	r1: "running 0.5s",
	r2: "running 1.5s",
};

// ── a real group, fed through the real registry ──────────────────────────────
const registry = new GroupRegistry({ now: () => 100_000 });
const mark = registry.mark();
registry.report({ callId: "c1", toolName: "bash", status: "ok", durationMs: 100 });
registry.report({ callId: "c2", toolName: "read", status: "ok", durationMs: 30 });
registry.report({ callId: "c3", toolName: "bash", status: "error", durationMs: 1800 });
registry.noteBoundary(mark);
const group = ["c1", "c2", "c3"];

rule("① 常态 level 0 —— 一段回复的 3 个工具折成一行（点击展开）");
drawGroup(registry, group);

rule("② 点摘要行 → level 1 行列表（│ 竖线；行间 1 空行是 pi 的节奏）");
registry.toggleHeader("c1");
drawGroup(registry, group);

rule("③ 点第 3 行 → level 2 该行展开完整内容（再点收回）");
registry.rowClick("c3");
drawGroup(registry, group, { c3: ["FAIL  test/app.test.ts", "AssertionError: expected 1 to be 2", "  at test/app.test.ts:12"] });

rule("④ Ctrl+O → 整体收回摘要（expanded 翻译）");
registry.noteSetExpanded("c3", false, false);
drawGroup(registry, group);

rule("⑤ edit/write 永不折 —— PINNED 卡恒完整（diff 是重点），并切断分组");
const pinned = registry.planFor("e1");
console.log(
	fmtPinned({ status: "ok", toolName: "edit", icon: "✏️", label: "~/src/app.ts", outcome: "+12/−3", durationMs: 300 }, theme),
);
for (const line of ["@@ -10,3 +10,3 @@", "- const x = 1;", "+ const x = 2;"]) console.log(c.toolOutput(`  ${line}`));

rule("⑥ 防闪 —— running <1s 不现身；≥1s 露一行计时");
const clock = new GroupRegistry({ now: () => 100_000 });
clock.report({ callId: "r1", toolName: "bash", status: "running", startedAt: 99_500 }); // 500ms
clock.report({ callId: "r2", toolName: "bash", status: "running", startedAt: 98_500 }); // 1.5s
drawGroup(clock, ["r1", "r2"]);

rule("⑦ 失败粘滞 —— 折叠态不吊红行，摘要带着红色计数（回到 ① 看 `1 failed`）");
console.log(fmtSummaryLine(registry.summary("c1")!, 0, theme), c.dim("   ← 折叠态长这样，失败数永远在"));
console.log(`\nRUNNING_ROW_DELAY_MS = ${RUNNING_ROW_DELAY_MS}ms\n`);
