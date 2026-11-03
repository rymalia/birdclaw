// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetBirdclawPathsForTests } from "./config";
import { getNativeDb, resetDatabaseForTests } from "./db";
import { repairDates } from "./date-repair";

const SNOWFLAKE_ID = "828473778791280640";
const PRE_SNOWFLAKE_ID = "12345678901";
const PLACEHOLDER_DATE = "1970-01-01T00:00:00.000Z";

let homeDir = "";

function insertTweet(id: string, createdAt: string) {
	getNativeDb({ seedDemoData: false })
		.prepare(
			"insert into tweets (id, author_profile_id, text, created_at) values (?, ?, ?, ?)",
		)
		.run(id, "profile_test", `tweet ${id}`, createdAt);
}

function insertCollection(tweetId: string, collectedAt: string) {
	getNativeDb({ seedDemoData: false })
		.prepare(
			`insert into tweet_collections
				(account_id, tweet_id, kind, collected_at, source, raw_json, updated_at)
			 values (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			"account_test",
			tweetId,
			"likes",
			collectedAt,
			"test",
			"{}",
			"2026-01-01T00:00:00.000Z",
		);
}

function seedRepairFixtures() {
	insertTweet(SNOWFLAKE_ID, PLACEHOLDER_DATE);
	insertTweet(PRE_SNOWFLAKE_ID, PLACEHOLDER_DATE);
	insertTweet("not-a-snowflake", PLACEHOLDER_DATE);
	insertTweet("untouched", "2026-01-02T03:04:05.006Z");
	insertCollection(SNOWFLAKE_ID, PLACEHOLDER_DATE);
	insertCollection(PRE_SNOWFLAKE_ID, "2026-01-03T04:05:06.007Z");
}

beforeEach(() => {
	homeDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-date-repair-"));
	process.env.BIRDCLAW_HOME = homeDir;
	resetBirdclawPathsForTests();
	resetDatabaseForTests();
});

afterEach(() => {
	resetDatabaseForTests();
	resetBirdclawPathsForTests();
	delete process.env.BIRDCLAW_HOME;
	rmSync(homeDir, { recursive: true, force: true });
});

describe("repairDates", () => {
	it("repairs Snowflake dates and clears collection placeholders", () => {
		seedRepairFixtures();

		const result = repairDates(getNativeDb({ seedDemoData: false }));

		expect(result).toEqual({
			tweetsCreatedAtRepaired: 1,
			placeholdersLeft: 2,
			collectionsPlaceholderCleared: 1,
		});
		expect(
			getNativeDb()
				.prepare("select created_at from tweets where id = ?")
				.get(SNOWFLAKE_ID),
		).toEqual({ created_at: "2017-02-06T05:21:55.819Z" });
		expect(
			getNativeDb()
				.prepare("select created_at from tweets where id = ?")
				.get(PRE_SNOWFLAKE_ID),
		).toEqual({ created_at: PLACEHOLDER_DATE });
		expect(
			getNativeDb()
				.prepare("select created_at from tweets where id = ?")
				.get("untouched"),
		).toEqual({ created_at: "2026-01-02T03:04:05.006Z" });
		expect(
			getNativeDb()
				.prepare(
					"select collected_at from tweet_collections where tweet_id = ?",
				)
				.get(SNOWFLAKE_ID),
		).toEqual({ collected_at: null });
		expect(
			getNativeDb()
				.prepare(
					"select collected_at from tweet_collections where tweet_id = ?",
				)
				.get(PRE_SNOWFLAKE_ID),
		).toEqual({ collected_at: "2026-01-03T04:05:06.007Z" });
	});

	it("is idempotent", () => {
		seedRepairFixtures();
		const db = getNativeDb({ seedDemoData: false });

		repairDates(db);

		expect(repairDates(db)).toEqual({
			tweetsCreatedAtRepaired: 0,
			placeholdersLeft: 2,
			collectionsPlaceholderCleared: 0,
		});
	});

	it("dry-runs with the same counts without writing", () => {
		seedRepairFixtures();
		const db = getNativeDb({ seedDemoData: false });
		const beforeTweets = db
			.prepare("select id, created_at from tweets order by id")
			.all();
		const beforeCollections = db
			.prepare(
				"select tweet_id, collected_at from tweet_collections order by tweet_id",
			)
			.all();

		expect(repairDates(db, { dryRun: true })).toEqual({
			tweetsCreatedAtRepaired: 1,
			placeholdersLeft: 2,
			collectionsPlaceholderCleared: 1,
		});
		expect(
			db.prepare("select id, created_at from tweets order by id").all(),
		).toEqual(beforeTweets);
		expect(
			db
				.prepare(
					"select tweet_id, collected_at from tweet_collections order by tweet_id",
				)
				.all(),
		).toEqual(beforeCollections);
	});
});
