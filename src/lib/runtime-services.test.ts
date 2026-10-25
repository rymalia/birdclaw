import { describe, expect, it, vi } from "vitest";
import { createRuntimeServices } from "./runtime-services";

describe("runtime services", () => {
	it("overrides selected boundaries without replacing the defaults", async () => {
		const fetch = vi.fn(async () => new Response("ok"));
		const runtime = createRuntimeServices({
			fetch,
			now: () => new Date("2026-06-15T12:00:00.000Z"),
			env: (name) => (name === "TOKEN" ? "secret" : undefined),
		});

		await expect(runtime.fetch("/test")).resolves.toBeInstanceOf(Response);
		expect(runtime.now().toISOString()).toBe("2026-06-15T12:00:00.000Z");
		expect(runtime.env("TOKEN")).toBe("secret");
		expect(runtime.random()).toBeGreaterThanOrEqual(0);
	});
});
