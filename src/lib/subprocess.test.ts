// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runSubprocess, SubprocessError } from "./subprocess";

describe("subprocess runtime", () => {
	it("captures bounded stdout and stderr", async () => {
		const result = await runSubprocess({
			command: process.execPath,
			args: ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
			maxBufferBytes: 1024,
		});
		expect(result).toMatchObject({ stdout: "out", stderr: "err", exitCode: 0 });
	});

	it("fails when output exceeds the configured bound", async () => {
		await expect(
			runSubprocess({
				command: process.execPath,
				args: ["-e", "process.stdout.write('x'.repeat(4096))"],
				maxBufferBytes: 32,
			}),
		).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
	});

	it("accepts configured nonzero exit codes", async () => {
		const result = await runSubprocess({
			command: process.execPath,
			args: ["-e", "process.stderr.write('expected'); process.exit(7)"],
			acceptedExitCodes: [0, 7],
		});
		expect(result).toMatchObject({ stderr: "expected", exitCode: 7 });
	});

	it("terminates commands on timeout", async () => {
		await expect(
			runSubprocess({
				command: process.execPath,
				args: ["-e", "setInterval(() => {}, 1000)"],
				timeoutMs: 20,
			}),
		).rejects.toMatchObject({ timedOut: true, aborted: false });
	});

	it("honors external abort signals", async () => {
		const controller = new AbortController();
		const pending = runSubprocess({
			command: process.execPath,
			args: ["-e", "setInterval(() => {}, 1000)"],
			signal: controller.signal,
		});
		controller.abort();
		await expect(pending).rejects.toMatchObject({ aborted: true });
	});

	it("redacts secrets from command errors", async () => {
		const secret = "super-secret-token";
		let error: unknown;
		try {
			await runSubprocess({
				command: process.execPath,
				args: [
					"-e",
					`process.stderr.write('${secret} https://user:password@example.com'); process.exit(2)`,
				],
				redactValues: [secret],
			});
		} catch (cause) {
			error = cause;
		}
		expect(error).toBeInstanceOf(SubprocessError);
		expect(JSON.stringify(error)).not.toContain(secret);
		expect(JSON.stringify(error)).not.toContain("password");
		expect(error).toMatchObject({
			stderr: expect.stringContaining("[REDACTED]"),
		});
	});
});
