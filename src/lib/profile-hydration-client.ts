import type { QueryClient } from "@tanstack/react-query";
import {
	profileHydrationResponseSchema,
	type ProfileHydrationResponse,
} from "./api-contracts";
import { fetchJson } from "./api-client";
import { queryKeys } from "./query-client";
import type { ProfileRecord } from "./types";

export type ProfileHydrationResult =
	ProfileHydrationResponse["results"][number];

export const PROFILE_HYDRATION_BATCH_LIMIT = 50;
export const PROFILE_HYDRATION_HIT_STALE_MS = 30 * 60_000;
export const PROFILE_HYDRATION_MISS_STALE_MS = 5 * 60_000;
export const PROFILE_HYDRATION_ERROR_STALE_MS = 0;

export interface ProfileHydrationBatch {
	results: ProfileHydrationResult[];
	profiles: ProfileRecord[];
	fetchedResults: ProfileHydrationResult[];
}

interface ResolvedHydration {
	result: ProfileHydrationResult;
	fetched: boolean;
}

interface PendingHydration {
	promise: Promise<ResolvedHydration>;
	resolve: (value: ResolvedHydration) => void;
	reject: (reason: unknown) => void;
}

const pendingByClient = new WeakMap<
	QueryClient,
	Map<string, PendingHydration>
>();

export function normalizeProfileHydrationHandle(value: string) {
	return value.trim().replace(/^@/, "").toLowerCase();
}

export function profileHydrationQueryKey(handle: string) {
	return [
		...queryKeys.profileHydration,
		normalizeProfileHydrationHandle(handle),
	] as const;
}

function pendingHydrations(queryClient: QueryClient) {
	let pending = pendingByClient.get(queryClient);
	if (!pending) {
		pending = new Map();
		pendingByClient.set(queryClient, pending);
	}
	return pending;
}

function createPendingHydration(): PendingHydration {
	let resolve!: (value: ResolvedHydration) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<ResolvedHydration>(
		(resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		},
	);
	return { promise, resolve, reject };
}

function resultStaleTime(result: ProfileHydrationResult) {
	if (result.status === "hit") return PROFILE_HYDRATION_HIT_STALE_MS;
	if (result.status === "miss") return PROFILE_HYDRATION_MISS_STALE_MS;
	return PROFILE_HYDRATION_ERROR_STALE_MS;
}

function freshCachedResult(queryClient: QueryClient, handle: string) {
	const queryKey = profileHydrationQueryKey(handle);
	const result = queryClient.getQueryData<ProfileHydrationResult>(queryKey);
	const state = queryClient.getQueryState<ProfileHydrationResult>(queryKey);
	if (!result || !state) return null;
	const staleTime = resultStaleTime(result);
	return staleTime > 0 && Date.now() - state.dataUpdatedAt < staleTime
		? result
		: null;
}

function normalizedHandles(values: Iterable<string>, limit: number) {
	const handles = new Set<string>();
	for (const value of values) {
		const handle = normalizeProfileHydrationHandle(value);
		if (!/^[a-z0-9_]{1,15}$/.test(handle)) continue;
		handles.add(handle);
		if (handles.size >= limit) break;
	}
	return [...handles];
}

async function fetchHydrationBatch(handles: string[]) {
	const url = new URL("/api/profile-hydrate", window.location.origin);
	url.searchParams.set("handles", handles.join(","));
	return fetchJson(
		url,
		undefined,
		profileHydrationResponseSchema,
		"Profile hydration failed",
	);
}

function missingResult(handle: string): ProfileHydrationResult {
	return {
		handle,
		status: "error",
		source: "cache",
		error: "Profile hydration response omitted this handle",
	};
}

export async function hydrateProfileHandles(
	queryClient: QueryClient,
	values: Iterable<string>,
	options: { limit?: number } = {},
): Promise<ProfileHydrationBatch> {
	const requestedLimit = Math.max(
		0,
		Math.floor(options.limit ?? PROFILE_HYDRATION_BATCH_LIMIT),
	);
	const limit = Math.min(requestedLimit, PROFILE_HYDRATION_BATCH_LIMIT);
	if (limit === 0) {
		return { results: [], profiles: [], fetchedResults: [] };
	}
	const handles = normalizedHandles(values, limit);
	if (handles.length === 0) {
		return { results: [], profiles: [], fetchedResults: [] };
	}

	const pending = pendingHydrations(queryClient);
	const work = new Map<string, Promise<ResolvedHydration>>();
	const newHandles: string[] = [];

	for (const handle of handles) {
		const cached = freshCachedResult(queryClient, handle);
		if (cached) {
			work.set(handle, Promise.resolve({ result: cached, fetched: false }));
			continue;
		}
		const existing = pending.get(handle);
		if (existing) {
			work.set(handle, existing.promise);
			continue;
		}
		const created = createPendingHydration();
		pending.set(handle, created);
		work.set(handle, created.promise);
		newHandles.push(handle);
	}

	if (newHandles.length > 0) {
		void fetchHydrationBatch(newHandles)
			.then((response) => {
				const results = new Map(
					response.results.map((result) => [
						normalizeProfileHydrationHandle(result.handle),
						result,
					]),
				);
				for (const handle of newHandles) {
					const rawResult = results.get(handle);
					const result = rawResult
						? { ...rawResult, handle }
						: missingResult(handle);
					queryClient.setQueryData(profileHydrationQueryKey(handle), result);
					pending.get(handle)?.resolve({ result, fetched: true });
					pending.delete(handle);
				}
			})
			.catch((error: unknown) => {
				for (const handle of newHandles) {
					pending.get(handle)?.reject(error);
					pending.delete(handle);
				}
			});
	}

	const resolved = await Promise.all(
		handles.map((handle) => work.get(handle) as Promise<ResolvedHydration>),
	);
	const results = resolved.map(({ result }) => result);
	return {
		results,
		profiles: results.flatMap((result) =>
			result.status === "hit" && result.profile ? [result.profile] : [],
		),
		fetchedResults: resolved.flatMap(({ result, fetched }) =>
			fetched ? [result] : [],
		),
	};
}
