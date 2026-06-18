// @vitest-environment node
import { describe, expect, it } from "vitest";
import { useTestHome } from "../test/test-home";
import { createServerRuntimeServices } from "./server-runtime-services";
import { deleteSyncCache, readSyncCache, writeSyncCache } from "./sync-cache";

const testHome = useTestHome({ prefix: "birdclaw-sync-cache-" });

describe("sync cache", () => {
	it("stores and deletes structured payloads", () => {
		const { db } = testHome();

		const updatedAt = writeSyncCache(
			"mentions:test",
			{ ok: true, count: 2 },
			db,
			createServerRuntimeServices({
				now: () => new Date("2026-06-15T12:00:00.000Z"),
			}),
		);

		expect(
			readSyncCache<{ ok: boolean; count: number }>("mentions:test", db),
		).toEqual(
			expect.objectContaining({
				value: { ok: true, count: 2 },
				updatedAt: "2026-06-15T12:00:00.000Z",
			}),
		);
		expect(updatedAt).toBe("2026-06-15T12:00:00.000Z");

		deleteSyncCache("mentions:test", db);
		expect(readSyncCache("mentions:test", db)).toBeNull();
	});

	it("returns null for corrupted cached json", () => {
		const { db } = testHome();

		db.prepare(
			"insert into sync_cache (cache_key, value_json, updated_at) values (?, ?, ?)",
		).run("mentions:bad", "{not-json", "2026-03-09T00:00:00.000Z");

		expect(readSyncCache("mentions:bad", db)).toBeNull();
	});
});
