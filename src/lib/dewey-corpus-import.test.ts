// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetBirdclawPathsForTests } from "./config";
import { getNativeDb, resetDatabaseForTests } from "./db";
import {
	importDeweyCorpus,
	resolveCreatedAt,
	toXurlTweet,
	toXurlUser,
} from "./dewey-corpus-import";

const ACCOUNT = "acct_test";
// Real-shaped Snowflake IDs (post times decode to 2021-2023).
const STUB_ID = "1357028260832550912";
const LIVE_ID = "1657991179667947520";
const NEW_ID = "1663318591482085376";
const UNHYDRATED_ID = "1582035375207301121";
const QUOTED_ID = "1357019825990631424";

let homeDir = "";
let corpusPath = "";

function db() {
	return getNativeDb({ seedDemoData: false });
}

function author(
	id: string,
	username: string,
	observedAt: string,
	bio = "dp bio",
) {
	return {
		id,
		username,
		name: `${username} name`,
		observed_at: observedAt,
		profile: {
			description: bio,
			followers_count: 4141862,
			following_count: 12,
			tweet_count: 27188,
			listed_count: null,
			profile_image_url: "https://pbs.twimg.com/profile_images/1/a_normal.jpg",
			created_at: "Thu Feb 01 23:05:04 +0000 2007",
			is_blue_verified: true,
		},
	};
}

function hydratedRecord(
	id: string,
	overrides: Record<string, unknown> = {},
	record: Record<string, unknown> = {},
) {
	return {
		tweet_id: id,
		csv: { date: "", content: "csv text", author_handle: "csvhandle" },
		bookmarked_at: "2025-05-23T20:55:43.195Z",
		hydrated: {
			source: "bird",
			full_text: `dp text ${id}`,
			text_source: "bird",
			created_at_utc: "Mon May 29 22:57:09 +0000 2023",
			conversation_id: id,
			in_reply_to: null,
			quoted_tweet_id: null,
			metrics: {
				reply: 1,
				retweet: 2,
				like: 41,
				quote: 0,
				bookmark: 2,
				impression: 4771,
			},
			entities: { urls: [], hashtags: ["tag"], mentions: [] },
			media: [],
			author: author("1236101", "benedictevans", "2026-11-03T10:19:25Z"),
			edit: { edit_history_tweet_ids: [id] },
			...overrides,
		},
		...record,
	};
}

function writeCorpus(records: unknown[]) {
	writeFileSync(
		corpusPath,
		`${records.map((record) => JSON.stringify(record)).join("\n")}\nnot json\n`,
	);
}

function tweetRow(id: string) {
	return db()
		.prepare(
			"select author_profile_id, text, created_at from tweets where id = ?",
		)
		.get(id) as
		| { author_profile_id: string; text: string; created_at: string }
		| undefined;
}

function tweetMediaRow(id: string) {
	return db()
		.prepare(
			"select author_profile_id, text, created_at, media_count, media_json from tweets where id = ?",
		)
		.get(id) as
		| {
				author_profile_id: string;
				text: string;
				created_at: string;
				media_count: number;
				media_json: string;
		  }
		| undefined;
}

function bookmarkRow(id: string) {
	return db()
		.prepare(
			"select collected_at, source from tweet_collections where account_id = ? and tweet_id = ? and kind = 'bookmarks'",
		)
		.get(ACCOUNT, id) as
		| { collected_at: string | null; source: string }
		| undefined;
}

function tableCounts() {
	const count = (table: string) =>
		(db().prepare(`select count(*) as n from ${table}`).get() as { n: number })
			.n;
	return {
		tweets: count("tweets"),
		collections: count("tweet_collections"),
		profiles: count("profiles"),
		snapshots: count("profile_snapshots"),
		revisions: count("tweet_revisions"),
	};
}

beforeEach(() => {
	homeDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-dewey-corpus-"));
	process.env.BIRDCLAW_HOME = homeDir;
	corpusPath = path.join(homeDir, "corpus.jsonl");
	resetBirdclawPathsForTests();
	resetDatabaseForTests();
});

afterEach(() => {
	resetDatabaseForTests();
	resetBirdclawPathsForTests();
	delete process.env.BIRDCLAW_HOME;
	rmSync(homeDir, { recursive: true, force: true });
});

describe("dewey corpus mapping", () => {
	it("normalizes Twitter-style dates and keeps note tweets whole", () => {
		const long = "x".repeat(400);
		const mapped = toXurlTweet(
			hydratedRecord(NEW_ID, { full_text: long, text_source: "note_tweet" }),
		);
		expect(mapped?.tweet.created_at).toBe("2023-05-29T22:57:09.000Z");
		expect(mapped?.tweet.note_tweet?.text).toBe(long);
		expect(mapped?.tweet.bookmarked_at).toBe("2025-05-23T20:55:43.195Z");
	});

	it("maps video variants and references", () => {
		const mapped = toXurlTweet(
			hydratedRecord(NEW_ID, {
				in_reply_to: "1657965228120735745",
				quoted_tweet_id: QUOTED_ID,
				media: [
					{
						type: "video",
						media_key: "7_1",
						preview_url: "https://pbs.twimg.com/thumb.jpg",
						duration_ms: 87288,
						variants: [
							{
								url: "https://video.twimg.com/a.mp4",
								bitrate: 832000,
								content_type: "video/mp4",
							},
						],
					},
				],
			}),
		);
		expect(mapped?.tweet.attachments?.media_keys).toEqual(["7_1"]);
		expect(mapped?.media[0]?.variants?.[0]?.bit_rate).toBe(832000);
		expect(mapped?.tweet.referenced_tweets).toEqual([
			{ type: "replied_to", id: "1657965228120735745" },
			{ type: "quoted", id: QUOTED_ID },
		]);
	});

	it("maps keyless photos and legacy video URLs into stable media includes", () => {
		const mapped = toXurlTweet(
			hydratedRecord(NEW_ID, {
				media: [
					{ type: "photo", url: "https://pbs.twimg.com/photo.jpg" },
					{
						type: "video",
						url: "https://pbs.twimg.com/thumb.jpg",
						video_url: "https://video.twimg.com/clip.mp4",
					},
				],
			}),
		);
		expect(mapped?.media).toEqual([
			{
				media_key: `dewey_${NEW_ID}_0`,
				type: "photo",
				url: "https://pbs.twimg.com/photo.jpg",
			},
			{
				media_key: `dewey_${NEW_ID}_1`,
				type: "video",
				url: "https://pbs.twimg.com/thumb.jpg",
				preview_image_url: "https://pbs.twimg.com/thumb.jpg",
				variants: [
					{
						url: "https://video.twimg.com/clip.mp4",
						content_type: "video/mp4",
					},
				],
			},
		]);
	});

	it("stores legacy videos with the poster as url and thumbnail", async () => {
		writeCorpus([
			{
				tweet_id: UNHYDRATED_ID,
				csv: { date: "", content: "deleted video tweet" },
				bookmarked_at: null,
				hydrated: {
					source: "bird",
					media: [
						{
							type: "video",
							url: "https://pbs.twimg.com/thumb.jpg",
							video_url: "https://video.twimg.com/clip.mp4",
						},
					],
				},
			},
		]);
		await importDeweyCorpus(db(), corpusPath, { accountId: ACCOUNT });
		const row = db()
			.prepare("select media_json from tweets where id = ?")
			.get(UNHYDRATED_ID) as { media_json: string };
		expect(JSON.parse(row.media_json)).toEqual([
			{
				url: "https://pbs.twimg.com/thumb.jpg",
				type: "video",
				thumbnailUrl: "https://pbs.twimg.com/thumb.jpg",
				variants: [
					expect.objectContaining({ url: "https://video.twimg.com/clip.mp4" }),
				],
			},
		]);
	});

	it("refuses to guess an author when the hydrated author id is missing", () => {
		expect(
			toXurlTweet(hydratedRecord(NEW_ID, { author: null })),
		).toBeUndefined();
	});

	it("keeps public metrics so profile follower counts are not zeroed", () => {
		const user = toXurlUser(author("745273", "naval", "2026-11-03T09:52:52Z"));
		expect(user.public_metrics?.followers_count).toBe(4141862);
		expect(user.public_metrics).not.toHaveProperty("listed_count");
		expect(user.created_at).toBe("2007-02-01T23:05:04.000Z");
	});

	it("prefers the Snowflake over the minute-precision CSV date, then falls back to it as UTC", () => {
		expect(
			resolveCreatedAt({
				tweet_id: UNHYDRATED_ID,
				csv: { date: "2022-10-17T15:46:00" },
			}),
		).toBe("2022-10-17T15:46:40.902Z");
		expect(
			resolveCreatedAt({
				tweet_id: "12345",
				csv: { date: "2009-01-02T03:04:00" },
			}),
		).toBe("2009-01-02T03:04:00.000Z");
	});
});

describe("importDeweyCorpus", () => {
	function seedExisting() {
		const database = db();
		database
			.prepare(
				"insert into tweets (id, author_profile_id, text, created_at) values (?, 'profile_unknown', 'archive like text', '2021-02-03T18:08:44.000Z')",
			)
			.run(STUB_ID);
		database
			.prepare(
				"insert into tweets (id, author_profile_id, text, created_at, like_count) values (?, 'profile_user_999', 'live text', '2023-05-15T06:07:55.000Z', 77)",
			)
			.run(LIVE_ID);
		database
			.prepare(
				`insert into profiles (id, handle, display_name, bio, followers_count, raw_json, created_at)
				 values ('profile_user_1236101', 'benedictevans', 'Benedict', 'live bio', 9,
				 '{"id":"1236101","username":"benedictevans","public_metrics":{"followers_count":9}}', '2026-01-01T00:00:00.000Z')`,
			)
			.run();
		database
			.prepare(
				`insert into tweet_collections (account_id, tweet_id, kind, collected_at, source, raw_json, updated_at)
				 values (?, ?, 'bookmarks', '2024-01-01T00:00:00.000Z', 'bird', '{}', '2026-01-01T00:00:00.000Z'),
				        (?, ?, 'bookmarks', null, 'xurl', '{}', '2026-01-01T00:00:00.000Z')`,
			)
			.run(ACCOUNT, LIVE_ID, ACCOUNT, STUB_ID);
	}

	function corpus() {
		return [
			hydratedRecord(STUB_ID, {
				author: author(
					"759636717569708032",
					"eerdincus",
					"2026-11-03T09:56:15Z",
				),
			}),
			hydratedRecord(LIVE_ID),
			hydratedRecord(NEW_ID, {
				quoted_tweet_id: STUB_ID,
				quoted_tweet: {
					id: STUB_ID,
					author_id: "2600374380",
					username: "quoted_user",
					text: "thin quoted copy",
					created_at: "Wed Feb 03 17:35:13 +0000 2021",
				},
			}),
			{
				tweet_id: UNHYDRATED_ID,
				csv: {
					date: "2022-10-17T15:46:00",
					content: "unhydrated csv text",
					author_handle: "GregBunbury",
				},
				hydrated: null,
				bookmarked_at: null,
			},
		];
	}

	it("upgrades archive stubs, keeps live data, and fills only missing save times", async () => {
		seedExisting();
		writeCorpus(corpus());
		const result = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
			batchSize: 1,
		});

		// Archive stub becomes the real author, even though NEW_ID quotes it in a later batch.
		expect(tweetRow(STUB_ID)).toMatchObject({
			author_profile_id: "profile_user_759636717569708032",
			text: `dp text ${STUB_ID}`,
		});
		// Tweet already known from a live sync is untouched.
		expect(tweetRow(LIVE_ID)).toMatchObject({
			author_profile_id: "profile_user_999",
			text: "live text",
		});
		expect(tweetRow(NEW_ID)?.author_profile_id).toBe("profile_user_1236101");
		// No author guessed from the CSV handle.
		expect(tweetRow(UNHYDRATED_ID)).toMatchObject({
			author_profile_id: "profile_unknown",
			text: "unhydrated csv text",
			created_at: "2022-10-17T15:46:40.902Z",
		});

		expect(bookmarkRow(LIVE_ID)).toEqual({
			collected_at: "2024-01-01T00:00:00.000Z",
			source: "bird",
		});
		expect(bookmarkRow(STUB_ID)).toEqual({
			collected_at: "2025-05-23T20:55:43.195Z",
			source: "xurl",
		});
		expect(bookmarkRow(NEW_ID)).toEqual({
			collected_at: "2025-05-23T20:55:43.195Z",
			source: "dewey-pipeline",
		});
		expect(bookmarkRow(UNHYDRATED_ID)).toEqual({
			collected_at: null,
			source: "dewey-pipeline",
		});

		// The full local profile is not rolled back to the corpus copy.
		const profile = db()
			.prepare(
				"select bio, followers_count from profiles where id = 'profile_user_1236101'",
			)
			.get();
		expect(profile).toEqual({ bio: "live bio", followers_count: 9 });

		expect(result).toMatchObject({
			recordsRead: 4,
			malformedLines: 1,
			tweetsUpserted: 2,
			tweetsKept: 1,
			tweetsStubbed: 1,
			bookmarksAdded: 2,
			bookmarksSaveTimeFilled: 1,
			bookmarksUnchanged: 1,
			profilesCreated: 1,
			profilesKept: 1,
			quotedTweetsUpserted: 0,
		});
	});

	it("keeps records whose JSON strings contain raw U+2028 line separators", async () => {
		const text = "first line\u2028second line";
		// JSON.stringify leaves U+2028 raw, exactly as Python's ensure_ascii=False does.
		writeCorpus([hydratedRecord(NEW_ID, { full_text: text }), corpus()[3]]);
		const result = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
		});
		expect(result).toMatchObject({ recordsRead: 2, malformedLines: 1 });
		expect(tweetRow(NEW_ID)?.text).toBe(text);
	});

	it("makes stubbed tweets searchable", async () => {
		writeCorpus([corpus()[3]]);
		await importDeweyCorpus(db(), corpusPath, { accountId: ACCOUNT });
		const hit = db()
			.prepare(
				"select tweet_id from tweets_fts where tweets_fts match 'unhydrated'",
			)
			.all();
		expect(hit).toEqual([{ tweet_id: UNHYDRATED_ID }]);
	});

	it("writes hydrated media on a new profile_unknown stub", async () => {
		writeCorpus([
			hydratedRecord(UNHYDRATED_ID, {
				author: null,
				media: [{ type: "photo", url: "https://pbs.twimg.com/stub.jpg" }],
			}),
		]);
		const result = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
		});
		expect(tweetMediaRow(UNHYDRATED_ID)).toEqual({
			author_profile_id: "profile_unknown",
			text: `dp text ${UNHYDRATED_ID}`,
			created_at: "2023-05-29T22:57:09.000Z",
			media_count: 1,
			media_json: JSON.stringify([
				{ url: "https://pbs.twimg.com/stub.jpg", type: "image" },
			]),
		});
		expect(result).toMatchObject({ tweetsStubbed: 1, stubMediaFilled: 0 });
	});

	it("fills missing media on an existing profile_unknown stub once", async () => {
		const database = db();
		database
			.prepare(
				"insert into tweets (id, author_profile_id, text, created_at, media_json) values (?, 'profile_unknown', 'archive text', '2022-10-17T15:46:40.902Z', '[]')",
			)
			.run(UNHYDRATED_ID);
		const record = hydratedRecord(UNHYDRATED_ID, {
			author: null,
			full_text: "corpus text must not replace archive text",
			media: [{ type: "photo", url: "https://pbs.twimg.com/repaired.jpg" }],
		});
		writeCorpus([record]);
		const first = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
		});
		expect(first).toMatchObject({
			tweetsKept: 1,
			tweetsStubbed: 0,
			stubMediaFilled: 1,
		});
		expect(tweetMediaRow(UNHYDRATED_ID)).toEqual({
			author_profile_id: "profile_unknown",
			text: "archive text",
			created_at: "2022-10-17T15:46:40.902Z",
			media_count: 1,
			media_json: JSON.stringify([
				{ url: "https://pbs.twimg.com/repaired.jpg", type: "image" },
			]),
		});
		const afterFirst = tableCounts();
		const second = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
		});
		expect(second).toMatchObject({ tweetsKept: 1, stubMediaFilled: 0 });
		expect(tableCounts()).toEqual(afterFirst);
	});

	it("does not fill media on an existing known-author tweet", async () => {
		db()
			.prepare(
				"insert into tweets (id, author_profile_id, text, created_at, media_json) values (?, 'profile_user_999', 'live text', '2022-10-17T15:46:40.902Z', '[]')",
			)
			.run(UNHYDRATED_ID);
		writeCorpus([
			hydratedRecord(UNHYDRATED_ID, {
				author: null,
				media: [{ type: "photo", url: "https://pbs.twimg.com/ignored.jpg" }],
			}),
		]);
		const result = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
		});
		expect(tweetMediaRow(UNHYDRATED_ID)).toEqual({
			author_profile_id: "profile_user_999",
			text: "live text",
			created_at: "2022-10-17T15:46:40.902Z",
			media_count: 0,
			media_json: "[]",
		});
		expect(result).toMatchObject({ tweetsKept: 1, stubMediaFilled: 0 });
	});

	it("writes quoted tweets that are not corpus bookmarks, with a sparse author", async () => {
		const record = hydratedRecord(NEW_ID, {
			quoted_tweet_id: QUOTED_ID,
			quoted_tweet: {
				id: QUOTED_ID,
				author_id: "2600374380",
				username: "HuffmanLabDU",
				text: "quoted text",
				created_at: "Wed Feb 03 17:35:13 +0000 2021",
			},
		});
		writeCorpus([record]);
		const result = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
		});
		expect(result.quotedTweetsUpserted).toBe(1);
		expect(result.sparseProfilesCreated).toBe(1);
		expect(tweetRow(QUOTED_ID)).toMatchObject({
			author_profile_id: "profile_user_2600374380",
			text: "quoted text",
			created_at: "2021-02-03T17:35:13.000Z",
		});
		expect(bookmarkRow(QUOTED_ID)).toBeUndefined();
	});

	it("still writes quoted tweets when the bookmark itself is already a live tweet", async () => {
		db()
			.prepare(
				"insert into tweets (id, author_profile_id, text, created_at) values (?, 'profile_user_999', 'live text', '2023-05-29T22:57:09.000Z')",
			)
			.run(NEW_ID);
		writeCorpus([
			hydratedRecord(NEW_ID, {
				quoted_tweet_id: QUOTED_ID,
				quoted_tweet: {
					id: QUOTED_ID,
					author_id: "2600374380",
					username: "HuffmanLabDU",
					text: "quoted text",
					created_at: "Wed Feb 03 17:35:13 +0000 2021",
				},
			}),
		]);
		const result = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
		});
		expect(result).toMatchObject({ tweetsKept: 1, quotedTweetsUpserted: 1 });
		expect(tweetRow(NEW_ID)?.text).toBe("live text");
		expect(tweetRow(QUOTED_ID)?.author_profile_id).toBe(
			"profile_user_2600374380",
		);
	});

	it("is idempotent", async () => {
		seedExisting();
		writeCorpus(corpus());
		await importDeweyCorpus(db(), corpusPath, { accountId: ACCOUNT });
		const first = tableCounts();
		const second = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
		});
		expect(tableCounts()).toEqual(first);
		expect(second).toMatchObject({
			tweetsUpserted: 0,
			tweetsStubbed: 0,
			bookmarksAdded: 0,
			bookmarksSaveTimeFilled: 0,
			profilesCreated: 0,
			profilesUpgraded: 0,
		});
	});

	it("writes nothing on a dry run", async () => {
		seedExisting();
		writeCorpus(corpus());
		const before = tableCounts();
		const result = await importDeweyCorpus(db(), corpusPath, {
			accountId: ACCOUNT,
			dryRun: true,
		});
		expect(tableCounts()).toEqual(before);
		expect(tweetRow(STUB_ID)?.author_profile_id).toBe("profile_unknown");
		expect(result).toMatchObject({
			dryRun: true,
			bookmarksAdded: 2,
			tweetsUpserted: 2,
		});
	});
});
