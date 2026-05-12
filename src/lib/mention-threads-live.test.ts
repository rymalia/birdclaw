// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetBirdclawPathsForTests } from "./config";
import { getNativeDb, resetDatabaseForTests } from "./db";
import { listTimelineItems } from "./queries";

const mocks = vi.hoisted(() => ({
	listThreadViaBird: vi.fn(),
}));

vi.mock("./bird", () => ({
	listThreadViaBird: mocks.listThreadViaBird,
}));

const tempRoots: string[] = [];

function setupTempHome() {
	const tempRoot = mkdtempSync(path.join(os.tmpdir(), "birdclaw-threads-"));
	tempRoots.push(tempRoot);
	process.env.BIRDCLAW_HOME = tempRoot;
	resetBirdclawPathsForTests();
	resetDatabaseForTests();
	const db = getNativeDb();
	db.exec("delete from tweets; delete from tweets_fts;");
	db.prepare(
		`
    insert into tweets (
      id, account_id, author_profile_id, kind, text, created_at,
      is_replied, reply_to_id, like_count, media_count, bookmarked, liked,
      entities_json, media_json, quoted_tweet_id
    ) values (?, 'acct_primary', 'profile_user_42', 'mention', ?, ?, 0, null, 0, 0, 0, 0, '{}', '[]', null)
    `,
	).run("mention_1", "mention text", "2026-05-04T07:00:00.000Z");
}

function insertMention(id: string, text: string, createdAt: string) {
	getNativeDb()
		.prepare(
			`
    insert into tweets (
      id, account_id, author_profile_id, kind, text, created_at,
      is_replied, reply_to_id, like_count, media_count, bookmarked, liked,
      entities_json, media_json, quoted_tweet_id
    ) values (?, 'acct_primary', 'profile_user_42', 'mention', ?, ?, 0, null, 0, 0, 0, 0, '{}', '[]', null)
    `,
		)
		.run(id, text, createdAt);
}

afterEach(() => {
	resetDatabaseForTests();
	resetBirdclawPathsForTests();
	delete process.env.BIRDCLAW_HOME;
	mocks.listThreadViaBird.mockReset();
	for (const tempRoot of tempRoots.splice(0)) {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

describe("mention thread sync", () => {
	it("fetches recent mention threads with timeout and stores conversation context", async () => {
		setupTempHome();
		mocks.listThreadViaBird.mockResolvedValue({
			data: [
				{
					id: "root_1",
					author_id: "25401953",
					text: "root post",
					created_at: "2026-05-04T06:00:00.000Z",
					conversation_id: "root_1",
					public_metrics: { like_count: 10 },
				},
				{
					id: "mention_1",
					author_id: "42",
					text: "mention text",
					created_at: "2026-05-04T07:00:00.000Z",
					conversation_id: "root_1",
					referenced_tweets: [{ type: "replied_to", id: "root_1" }],
					public_metrics: { like_count: 2 },
				},
				{
					id: "side_reply_1",
					author_id: "43",
					text: "side reply",
					created_at: "2026-05-04T07:01:00.000Z",
					conversation_id: "root_1",
					referenced_tweets: [{ type: "replied_to", id: "root_1" }],
				},
			],
			includes: {
				users: [
					{ id: "25401953", username: "steipete", name: "Peter" },
					{ id: "42", username: "sam", name: "Sam" },
					{ id: "43", username: "alex", name: "Alex" },
				],
			},
			meta: { result_count: 3 },
		});
		const { syncMentionThreads } = await import("./mention-threads-live");

		const result = await syncMentionThreads({
			limit: 1,
			delayMs: 0,
			timeoutMs: 5000,
		});
		const db = getNativeDb();
		const sideReply = db
			.prepare("select kind, reply_to_id from tweets where id = ?")
			.get("side_reply_1");
		const home = listTimelineItems({ resource: "home", limit: 10 });
		const mentions = listTimelineItems({ resource: "mentions", limit: 10 });

		expect(result).toMatchObject({
			ok: true,
			mentions: 1,
			succeeded: 1,
			failed: 0,
			mergedTweets: 3,
			uniqueTweets: 3,
		});
		expect(mocks.listThreadViaBird).toHaveBeenCalledWith({
			tweetId: "mention_1",
			all: false,
			maxPages: undefined,
			timeoutMs: 5000,
		});
		expect(home.find((item) => item.id === "root_1")).toMatchObject({
			kind: "home",
			author: { handle: "steipete" },
		});
		expect(mentions.find((item) => item.id === "mention_1")).toMatchObject({
			kind: "mention",
			replyToTweet: expect.objectContaining({ id: "root_1" }),
		});
		expect(sideReply).toEqual({ kind: "thread", reply_to_id: "root_1" });
	});

	it("persists thread video variants in media_json", async () => {
		setupTempHome();
		mocks.listThreadViaBird.mockResolvedValue({
			data: [
				{
					id: "mention_1",
					author_id: "42",
					text: "mention text",
					created_at: "2026-05-04T07:00:00.000Z",
					conversation_id: "mention_1",
					attachments: { media_keys: ["video_1"] },
				},
			],
			includes: {
				users: [{ id: "42", username: "sam", name: "Sam" }],
				media: [
					{
						media_key: "video_1",
						type: "video",
						preview_image_url:
							"https://pbs.twimg.com/ext_tw_video_thumb/video_1.jpg",
						duration_ms: 46947,
						variants: [
							{
								url: "https://video.twimg.com/ext_tw_video/high.mp4",
								content_type: "video/mp4",
								bit_rate: 2176000,
							},
						],
					},
				],
			},
			meta: { result_count: 1 },
		});
		const { syncMentionThreads } = await import("./mention-threads-live");

		await syncMentionThreads({ limit: 1, delayMs: 0, timeoutMs: 5000 });
		const row = getNativeDb()
			.prepare("select media_count, media_json from tweets where id = ?")
			.get("mention_1") as { media_count: number; media_json: string };

		expect(row.media_count).toBe(1);
		expect(JSON.parse(row.media_json)).toMatchObject([
			{
				type: "video",
				durationMs: 46947,
				variants: [{ bitRate: 2176000 }],
			},
		]);
	});

	it("records failed thread fetches without failing the sync", async () => {
		setupTempHome();
		mocks.listThreadViaBird.mockRejectedValue(new Error("rate limited"));
		const { syncMentionThreads } = await import("./mention-threads-live");

		const result = await syncMentionThreads({
			limit: 1,
			delayMs: 0,
			timeoutMs: 1000,
		});

		expect(result).toMatchObject({
			ok: true,
			mentions: 1,
			succeeded: 0,
			failed: 1,
			failures: [{ tweetId: "mention_1", error: "rate limited" }],
		});
	});

	it("handles multiple mentions, delay, non-error failures, and stub authors", async () => {
		setupTempHome();
		insertMention("mention_2", "newer mention", "2026-05-04T08:00:00.000Z");
		mocks.listThreadViaBird
			.mockResolvedValueOnce({
				data: [
					{
						id: "mention_2",
						author_id: "42",
						text: "newer mention",
						created_at: "2026-05-04T08:00:00.000Z",
						entities: {
							urls: [
								{ media_key: "media_1" },
								{ media_key: false },
								"not an object",
							],
						},
					},
					{
						id: "unknown_reply",
						author_id: "77",
						text: "unknown author reply",
						created_at: "2026-05-04T08:01:00.000Z",
					},
				],
				meta: { result_count: 2 },
			})
			.mockRejectedValueOnce("temporary failure");
		const { syncMentionThreads } = await import("./mention-threads-live");

		const result = await syncMentionThreads({
			limit: 2,
			delayMs: 1,
			timeoutMs: 1200,
			all: true,
			maxPages: 3,
		});
		const row = getNativeDb()
			.prepare("select media_count, author_profile_id from tweets where id = ?")
			.get("unknown_reply");

		expect(result).toMatchObject({
			mentions: 2,
			succeeded: 1,
			failed: 1,
			mergedTweets: 2,
			uniqueTweets: 2,
			options: { delayMs: 1, timeoutMs: 1200, all: true, maxPages: 3 },
			failures: [{ tweetId: "mention_1", error: "temporary failure" }],
		});
		expect(mocks.listThreadViaBird).toHaveBeenNthCalledWith(1, {
			tweetId: "mention_2",
			all: true,
			maxPages: 3,
			timeoutMs: 1200,
		});
		expect(row).toMatchObject({
			media_count: 0,
			author_profile_id: "profile_user_77",
		});
	});

	it("validates mention thread sync options", async () => {
		setupTempHome();
		const { syncMentionThreads } = await import("./mention-threads-live");

		await expect(syncMentionThreads({ limit: 0 })).rejects.toThrow(
			"--limit must be at least 1",
		);
		await expect(syncMentionThreads({ delayMs: -1 })).rejects.toThrow(
			"--delay-ms must be non-negative",
		);
		await expect(syncMentionThreads({ timeoutMs: 0 })).rejects.toThrow(
			"--timeout-ms must be at least 1",
		);
		await expect(syncMentionThreads({ maxPages: -1 })).rejects.toThrow(
			"--max-pages must be non-negative",
		);
		await expect(syncMentionThreads({ account: "missing" })).rejects.toThrow(
			"Unknown account: missing",
		);
	});
});
