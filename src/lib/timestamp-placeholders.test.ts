// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	insertTestAccount,
	insertTestProfile,
	insertTestTweet,
	useTestHome,
} from "../test/test-home";
import { importArchive } from "./archive-import";
import { exportBackup, importBackup } from "./backup";
import { getNativeDb } from "./db";

const EPOCH_PLACEHOLDER = "1970-01-01T00:00:00.000Z";
const testHome = useTestHome({ prefix: "birdclaw-timestamp-placeholders-" });

function makeLikeArchive(createdAt?: string, collectedAt?: string) {
	const root = testHome().makeTempDir("birdclaw-like-archive-");
	const archiveDir = path.join(root, "sample", "data");
	mkdirSync(archiveDir, { recursive: true });

	writeFileSync(
		path.join(archiveDir, "account.js"),
		`window.YTD.account.part0 = [{ "account": { "accountId": "25401953", "username": "steipete", "accountDisplayName": "Peter Steinberger" } }]`,
	);
	writeFileSync(
		path.join(archiveDir, "profile.js"),
		`window.YTD.profile.part0 = [{ "profile": { "description": { "bio": "Local-first builder" } } }]`,
	);
	writeFileSync(
		path.join(archiveDir, "like.js"),
		`window.YTD.like.part0 = ${JSON.stringify([
			{
				like: {
					tweetId: "5",
					fullText: "liked archive item",
					...(createdAt ? { createdAt } : {}),
					...(collectedAt ? { likedAt: collectedAt } : {}),
				},
			},
		])}`,
	);

	const archivePath = path.join(root, "archive.zip");
	execFileSync("zip", ["-qr", archivePath, "sample"], { cwd: root });
	return archivePath;
}

describe("timestamp placeholders", () => {
	it("upgrades an archive collection placeholder but preserves a real date", async () => {
		await importArchive(makeLikeArchive(), { select: ["likes"] });
		const db = getNativeDb({ seedDemoData: false });
		expect(
			db.prepare("select created_at from tweets where id = '5'").get(),
		).toEqual({ created_at: EPOCH_PLACEHOLDER });

		await importArchive(makeLikeArchive("2025-06-03T19:32:20.000Z"), {
			select: ["likes"],
		});
		expect(
			db.prepare("select created_at from tweets where id = '5'").get(),
		).toEqual({ created_at: "2025-06-03T19:32:20.000Z" });

		await importArchive(makeLikeArchive("2026-06-03T19:32:20.000Z"), {
			select: ["likes"],
		});
		expect(
			db.prepare("select created_at from tweets where id = '5'").get(),
		).toEqual({ created_at: "2025-06-03T19:32:20.000Z" });
	});

	it("merges archive collection dates while ignoring the epoch placeholder", async () => {
		const db = getNativeDb({ seedDemoData: false });

		await importArchive(makeLikeArchive(), { select: ["likes"] });
		db.prepare(
			"update tweet_collections set collected_at = ? where tweet_id = '5'",
		).run(EPOCH_PLACEHOLDER);
		await importArchive(makeLikeArchive(), { select: ["likes"] });
		expect(
			db
				.prepare(
					"select collected_at from tweet_collections where tweet_id = '5'",
				)
				.get(),
		).toEqual({ collected_at: null });

		await importArchive(
			makeLikeArchive(undefined, "2025-06-02T00:00:00.000Z"),
			{
				select: ["likes"],
			},
		);
		await importArchive(makeLikeArchive(), { select: ["likes"] });
		expect(
			db
				.prepare(
					"select collected_at from tweet_collections where tweet_id = '5'",
				)
				.get(),
		).toEqual({ collected_at: "2025-06-02T00:00:00.000Z" });

		await importArchive(
			makeLikeArchive(undefined, "2025-06-03T00:00:00.000Z"),
			{
				select: ["likes"],
			},
		);
		expect(
			db
				.prepare(
					"select collected_at from tweet_collections where tweet_id = '5'",
				)
				.get(),
		).toEqual({ collected_at: "2025-06-03T00:00:00.000Z" });
	});

	it("merges backup tweet dates while ignoring the epoch placeholder", async () => {
		const sourceDb = getNativeDb({ seedDemoData: false });
		insertTestAccount(sourceDb);
		insertTestProfile(sourceDb);
		insertTestTweet(sourceDb, {
			id: "backup-placeholder-incoming",
			createdAt: EPOCH_PLACEHOLDER,
		});
		insertTestTweet(sourceDb, {
			id: "backup-real-replaces-placeholder",
			createdAt: "2025-06-02T00:00:00.000Z",
		});
		insertTestTweet(sourceDb, {
			id: "backup-earliest-real",
			createdAt: "2025-06-01T00:00:00.000Z",
		});
		const repoPath = testHome().makeTempDir("birdclaw-backup-");
		await exportBackup({ repoPath, db: sourceDb });

		testHome().switchHome("birdclaw-timestamp-destination-");
		const destinationDb = getNativeDb({ seedDemoData: false });
		insertTestAccount(destinationDb);
		insertTestProfile(destinationDb);
		insertTestTweet(destinationDb, {
			id: "backup-placeholder-incoming",
			createdAt: "2025-06-03T00:00:00.000Z",
		});
		insertTestTweet(destinationDb, {
			id: "backup-real-replaces-placeholder",
			createdAt: EPOCH_PLACEHOLDER,
		});
		insertTestTweet(destinationDb, {
			id: "backup-earliest-real",
			createdAt: "2025-06-03T00:00:00.000Z",
		});

		await importBackup({ repoPath, db: destinationDb });

		expect(
			destinationDb
				.prepare("select id, created_at from tweets order by id")
				.all(),
		).toEqual([
			{
				id: "backup-earliest-real",
				created_at: "2025-06-01T00:00:00.000Z",
			},
			{
				id: "backup-placeholder-incoming",
				created_at: "2025-06-03T00:00:00.000Z",
			},
			{
				id: "backup-real-replaces-placeholder",
				created_at: "2025-06-02T00:00:00.000Z",
			},
		]);
	});

	it("merges backup collection dates while ignoring the epoch placeholder", async () => {
		const sourceDb = getNativeDb({ seedDemoData: false });
		insertTestAccount(sourceDb);
		insertTestProfile(sourceDb);
		const backupRows = [
			["local-real-wins", "2025-06-01T00:00:00.000Z"],
			["placeholder-upgrades", "2025-06-02T00:00:00.000Z"],
			["placeholder-and-placeholder", EPOCH_PLACEHOLDER],
			["placeholder-and-null", null],
			["null-and-placeholder", EPOCH_PLACEHOLDER],
		] as const;
		for (const [id] of backupRows) insertTestTweet(sourceDb, { id });
		const insertCollection = sourceDb.prepare(`
			insert into tweet_collections (
				account_id, tweet_id, kind, collected_at, source, raw_json, updated_at
			) values ('account:test', ?, 'likes', ?, 'archive', '{}', '2026-01-01T00:00:00.000Z')
		`);
		for (const [id, collectedAt] of backupRows) {
			insertCollection.run(id, collectedAt);
		}
		const repoPath = testHome().makeTempDir("birdclaw-collection-backup-");
		await exportBackup({ repoPath, db: sourceDb });

		testHome().switchHome("birdclaw-collection-destination-");
		const destinationDb = getNativeDb({ seedDemoData: false });
		insertTestAccount(destinationDb);
		insertTestProfile(destinationDb);
		for (const [id] of backupRows) insertTestTweet(destinationDb, { id });
		const insertLocalCollection = destinationDb.prepare(`
			insert into tweet_collections (
				account_id, tweet_id, kind, collected_at, source, raw_json, updated_at
			) values ('account:test', ?, 'likes', ?, 'archive', '{}', '2026-01-01T00:00:00.000Z')
		`);
		for (const [id, collectedAt] of [
			["local-real-wins", "2025-06-03T00:00:00.000Z"],
			["placeholder-upgrades", EPOCH_PLACEHOLDER],
			["placeholder-and-placeholder", EPOCH_PLACEHOLDER],
			["placeholder-and-null", EPOCH_PLACEHOLDER],
			["null-and-placeholder", null],
		] as const) {
			insertLocalCollection.run(id, collectedAt);
		}

		await importBackup({ repoPath, db: destinationDb });
		expect(
			destinationDb
				.prepare(
					"select tweet_id, collected_at from tweet_collections order by tweet_id",
				)
				.all(),
		).toEqual([
			{ tweet_id: "local-real-wins", collected_at: "2025-06-03T00:00:00.000Z" },
			{ tweet_id: "null-and-placeholder", collected_at: null },
			{ tweet_id: "placeholder-and-null", collected_at: null },
			{ tweet_id: "placeholder-and-placeholder", collected_at: null },
			{
				tweet_id: "placeholder-upgrades",
				collected_at: "2025-06-02T00:00:00.000Z",
			},
		]);
	});
});
