// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildLaunchAgent,
	buildLaunchProgramArguments,
	installLaunchAgent,
	resolveUserPath,
} from "./launchd";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const tempDirs: string[] = [];

afterEach(() => {
	execFileMock.mockReset();
	for (const directory of tempDirs.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("launchd runtime", () => {
	it("resolves home paths and safely wraps env-file commands", () => {
		const envFile = "~/private env/it's.env";
		const args = buildLaunchProgramArguments({
			program: "/opt/homebrew/bin/birdclaw",
			args: ["--label", "value with spaces", "it's-safe"],
			envFile,
		});

		expect(resolveUserPath(envFile)).toBe(
			path.join(os.homedir(), "private env/it's.env"),
		);
		expect(args).toEqual(["/bin/bash", "-lc", expect.any(String)]);
		expect(args[2]).toContain("it'\\''s.env'");
		expect(args[2]).toContain("'value with spaces' 'it'\\''s-safe'");
	});

	it("renders one escaped launch agent plist shape", () => {
		const agent = buildLaunchAgent({
			label: "com.example.sync&test",
			intervalSeconds: 60,
			logPath: "~/birdclaw/audit.jsonl",
			stdoutPath: "~/birdclaw/out.log",
			stderrPath: "~/birdclaw/err.log",
			programArguments: ["/usr/bin/env", "birdclaw", "<sync>"],
		});

		expect(agent.plist).toContain("com.example.sync&amp;test");
		expect(agent.plist).toContain("&lt;sync&gt;");
		expect(agent.plist).toContain("<integer>60</integer>");
		expect(agent.logPath).toBe(path.join(os.homedir(), "birdclaw/audit.jsonl"));
	});

	it("writes and reloads launch agents through launchctl", async () => {
		const launchAgentsDir = mkdtempSync(
			path.join(os.tmpdir(), "birdclaw-launchd-runtime-"),
		);
		tempDirs.push(launchAgentsDir);
		const agent = buildLaunchAgent({
			label: "com.example.sync",
			intervalSeconds: 60,
			logPath: path.join(launchAgentsDir, "logs", "audit.jsonl"),
			stdoutPath: path.join(launchAgentsDir, "logs", "out.log"),
			stderrPath: path.join(launchAgentsDir, "logs", "err.log"),
			programArguments: ["/usr/bin/env", "birdclaw"],
		});
		execFileMock.mockImplementation((...args: unknown[]) => {
			const commandArgs = args[1] as string[];
			const callback = args.at(-1) as (
				error: Error | null,
				stdout?: string,
				stderr?: string,
			) => void;
			if (commandArgs[0] === "unload") {
				callback(new Error("not loaded"));
				return;
			}
			callback(null, "", "");
		});

		const result = await installLaunchAgent(agent, { launchAgentsDir });

		expect(result.loaded).toBe(true);
		expect(existsSync(result.plistPath)).toBe(true);
		expect(execFileMock).toHaveBeenNthCalledWith(
			1,
			"launchctl",
			["unload", result.plistPath],
			expect.any(Function),
		);
		expect(execFileMock).toHaveBeenNthCalledWith(
			2,
			"launchctl",
			["load", "-w", result.plistPath],
			expect.any(Function),
		);
	});
});
