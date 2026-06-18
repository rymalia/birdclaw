import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	PROFILE_HYDRATION_BATCH_LIMIT,
	PROFILE_HYDRATION_MISS_STALE_MS,
	hydrateProfileHandles,
	profileHydrationQueryKey,
} from "./profile-hydration-client";

function responseFor(
	handles: string[],
	status: "hit" | "miss" | "error" = "hit",
) {
	return new Response(
		JSON.stringify({
			ok: true,
			results: handles.map((handle) => ({
				handle,
				status,
				source: "bird",
				...(status === "hit"
					? {
							profile: {
								id: `profile_${handle}`,
								handle,
								displayName: handle,
								bio: "",
								followersCount: 1,
								avatarHue: 1,
								createdAt: "2020-01-01T00:00:00.000Z",
							},
						}
					: status === "error"
						? { error: "temporary" }
						: {}),
			})),
			hydratedProfiles: status === "hit" ? handles.length : 0,
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

function handlesFromRequest(input: RequestInfo | URL) {
	return new URL(String(input)).searchParams.get("handles")?.split(",") ?? [];
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("profile hydration client", () => {
	it("normalizes handles and dedupes overlapping concurrent batches", async () => {
		let releaseFirst!: () => void;
		const firstPending = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const requested: string[][] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const handles = handlesFromRequest(input);
				requested.push(handles);
				if (handles.includes("alice")) await firstPending;
				return responseFor(handles);
			}),
		);
		const queryClient = new QueryClient();

		const first = hydrateProfileHandles(queryClient, ["@Alice", "bob"]);
		const second = hydrateProfileHandles(queryClient, ["alice", "CHARLIE"]);
		await vi.waitFor(() => expect(requested).toHaveLength(2));
		expect(requested).toEqual([["alice", "bob"], ["charlie"]]);
		releaseFirst();

		await expect(first).resolves.toMatchObject({
			profiles: [{ handle: "alice" }, { handle: "bob" }],
		});
		await expect(second).resolves.toMatchObject({
			profiles: [{ handle: "alice" }, { handle: "charlie" }],
		});
		expect(
			queryClient.getQueryData(profileHydrationQueryKey("@ALICE")),
		).toMatchObject({
			status: "hit",
		});
	});

	it("caps one batch at the API limit", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const handles = handlesFromRequest(input);
			return responseFor(handles);
		});
		vi.stubGlobal("fetch", fetchMock);
		const handles = Array.from(
			{ length: 55 },
			(_, index) => `user${String(index)}`,
		);

		const result = await hydrateProfileHandles(new QueryClient(), handles, {
			limit: 100,
		});

		expect(
			handlesFromRequest(fetchMock.mock.calls[0]?.[0] as URL),
		).toHaveLength(PROFILE_HYDRATION_BATCH_LIMIT);
		expect(result.results).toHaveLength(PROFILE_HYDRATION_BATCH_LIMIT);
	});

	it("briefly caches misses but immediately retries item errors", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		let status: "hit" | "miss" | "error" = "miss";
		const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
			responseFor(handlesFromRequest(input), status),
		);
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();

		await hydrateProfileHandles(queryClient, ["alice"]);
		status = "hit";
		await hydrateProfileHandles(queryClient, ["alice"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(PROFILE_HYDRATION_MISS_STALE_MS + 1);
		await hydrateProfileHandles(queryClient, ["alice"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		status = "error";
		await hydrateProfileHandles(queryClient, ["bob"]);
		status = "hit";
		await hydrateProfileHandles(queryClient, ["bob"]);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("does not cache transport errors", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockImplementationOnce(async (input: RequestInfo | URL) =>
				responseFor(handlesFromRequest(input)),
			);
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();

		await expect(hydrateProfileHandles(queryClient, ["alice"])).rejects.toThrow(
			"offline",
		);
		await expect(
			hydrateProfileHandles(queryClient, ["alice"]),
		).resolves.toMatchObject({
			profiles: [{ handle: "alice" }],
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
