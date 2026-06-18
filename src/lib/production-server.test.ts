// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startProductionServer } from "./production-server";

const tempDirs: string[] = [];
const originalLocalWeb = process.env.BIRDCLAW_LOCAL_WEB;

afterEach(() => {
	if (originalLocalWeb === undefined) delete process.env.BIRDCLAW_LOCAL_WEB;
	else process.env.BIRDCLAW_LOCAL_WEB = originalLocalWeb;
	for (const directory of tempDirs.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("production server", () => {
	it("serves built assets before delegating requests to the SSR handler", async () => {
		const packageRoot = mkdtempSync(
			path.join(os.tmpdir(), "birdclaw-production-server-"),
		);
		tempDirs.push(packageRoot);
		const clientDir = path.join(packageRoot, "client");
		mkdirSync(path.join(clientDir, "assets"), { recursive: true });
		writeFileSync(path.join(clientDir, "assets", "app.js"), "built asset");
		const serverEntry = path.join(packageRoot, "server.mjs");
		writeFileSync(
			serverEntry,
			`export default { fetch(request) { return new Response("SSR " + new URL(request.url).pathname + " " + request.headers.get("x-birdclaw-local-peer"), { headers: { "content-type": "text/plain" } }); } };`,
		);

		const server = await startProductionServer({
			packageRoot,
			clientDir,
			serverEntry,
			port: 0,
		});
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("no address");
		const baseUrl = `http://127.0.0.1:${String(address.port)}`;

		await expect(
			fetch(`${baseUrl}/route`, {
				headers: { "x-birdclaw-local-peer": "forged" },
			}).then((response) => response.text()),
		).resolves.toBe("SSR /route 1");
		const asset = await fetch(`${baseUrl}/assets/app.js`);
		expect(await asset.text()).toBe("built asset");
		expect(asset.headers.get("content-type")).toBe(
			"text/javascript; charset=utf-8",
		);
		expect(asset.headers.get("cache-control")).toContain("immutable");
		expect(process.env.BIRDCLAW_LOCAL_WEB).toBe("socket");

		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	});
});
