/**
 * pi-helm UI strings — folding rows, summary line, tool descriptions.
 *
 * Pure (zero pi imports, zero side effects): renderers.ts and node --test
 * consume it directly. Default language is "en" so the test-suite keeps its
 * English shapes; index.ts switches to the user's settings language at
 * startup and on `/lang zh|en`.
 *
 * §i18n rule: interface words live here; established technical terms
 * (`exit N`, `ok`, commands, paths) stay as-is in both languages.
 */

export type Lang = "zh" | "en";

let lang: Lang = "en";

export function setLang(next: Lang): void {
	lang = next;
}

export function getLang(): Lang {
	return lang;
}

interface Words {
	/** `▸ ${calls(n)}` — pluralised. */
	calls(n: number): string;
	/** `✗ ${failed(n)}` — sticky failure count on the summary. */
	failed(n: number): string;
	/** `● ${running(n)}` — live running count. */
	running(n: number): string;
	/** Outcome: `${lines(n)} lines` — singular handled. */
	lines(n: number): string;
	/** Outcome: command finished clean. */
	done: string;
	/** Outcome: `running 2s` while a call is live. */
	runningFor(duration: string): string;
	/** Outcome: live but no clock yet (rare — first frame before startedAt). */
	inProgress: string;
	/** Scroll indicator: lines hidden above / below the pinned box viewport. */
	moreAbove(n: number): string;
	moreBelow(n: number): string;
	/** Outcome: nothing to say (kept as the loanword in both languages). */
	ok: string;
	/** reason-first fallback: what this tool call *does*, by tool name. */
	describe(toolName: string): string | undefined;
}

const EN: Words = {
	calls: (n) => `${n} call${n === 1 ? "" : "s"}`,
	failed: (n) => `${n} failed`,
	running: (n) => `${n} running`,
	lines: (n) => `${n} line${n === 1 ? "" : "s"}`,
	done: "done",
	runningFor: (d) => `running ${d}`,
	inProgress: "running",
	moreAbove: (n) => `▲ ${n} above`,
	moreBelow: (n) => `▼ ${n} below (wheel)`,
	ok: "ok",
	describe: (tool) => {
		switch (tool) {
			case "bash":
			case "powershell":
				return "run command";
			case "read":
				return "read file";
			case "edit":
				return "edit file";
			case "write":
				return "write file";
			case "grep":
				return "search content";
			case "find":
				return "find files";
			case "ls":
				return "list directory";
			default:
				return undefined;
		}
	},
};

const ZH: Words = {
	calls: (n) => `${n} 次调用`,
	failed: (n) => `${n} 次失败`,
	running: (n) => `${n} 个运行中`,
	lines: (n) => `${n} 行`,
	done: "完成",
	runningFor: (d) => `运行中 ${d}`,
	inProgress: "运行中",
	moreAbove: (n) => `▲ 上 ${n} 行`,
	moreBelow: (n) => `▼ 下 ${n} 行 (滚轮)`,
	ok: "ok",
	describe: (tool) => {
		switch (tool) {
			case "bash":
			case "powershell":
				return "运行命令";
			case "read":
				return "读取文件";
			case "edit":
				return "编辑文件";
			case "write":
				return "写入文件";
			case "grep":
				return "搜索内容";
			case "find":
				return "查找文件";
			case "ls":
				return "列出目录";
			default:
				return undefined;
		}
	},
};

/** The word-table for the current language (module-level: renderers read it per frame). */
export function words(): Words {
	return lang === "zh" ? ZH : EN;
}
