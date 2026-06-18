import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiFetchError, fetchJson } from "./api-client";
import { createRuntimeServices } from "./runtime-services";

describe("api client", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("preserves ApiFetchError and status across the Promise boundary", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message: "Rate limited" }), {
						status: 429,
					}),
			),
		);

		await expect(
			fetchJson(
				"/api/test",
				undefined,
				z.object({ ok: z.boolean() }),
				"Failed",
			),
		).rejects.toMatchObject({
			_tag: "ApiFetchError",
			message: "Rate limited",
			status: 429,
		});
		await expect(
			fetchJson(
				"/api/test",
				undefined,
				z.object({ ok: z.boolean() }),
				"Failed",
			),
		).rejects.toBeInstanceOf(ApiFetchError);
	});

	it("preserves AbortError so route hooks can ignore stale requests", async () => {
		const abortError = new DOMException(
			"The operation was aborted.",
			"AbortError",
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw abortError;
			}),
		);

		await expect(
			fetchJson(
				"/api/test",
				undefined,
				z.object({ ok: z.boolean() }),
				"Failed",
			),
		).rejects.toBe(abortError);
	});

	it("accepts an injected fetch service", async () => {
		const fetch = vi.fn(async () => Response.json({ ok: true }));

		await expect(
			fetchJson(
				"/api/test",
				undefined,
				z.object({ ok: z.boolean() }),
				"Failed",
				createRuntimeServices({ fetch }),
			),
		).resolves.toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledWith("/api/test");
	});

	it("rejects malformed successful responses at the shared boundary", async () => {
		const fetch = vi.fn(async () => Response.json({ ok: "yes" }));

		await expect(
			fetchJson(
				"/api/test",
				undefined,
				z.object({ ok: z.boolean() }),
				"Malformed response",
				createRuntimeServices({ fetch }),
			),
		).rejects.toMatchObject({
			_tag: "ApiFetchError",
			message: "Malformed response",
		});
	});
});
