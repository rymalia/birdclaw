import { createReadStream } from "node:fs";
import { buildTweetMedia, indexMediaIncludes } from "./media-includes";
import { refreshSearchRows } from "./search-index";
import { snowflakeToIso } from "./snowflake";
import type { Database } from "./sqlite";
import { ingestTweetPayload } from "./tweet-repository";
import type {
	XurlMediaItem,
	XurlMentionUser,
	XurlMentionsResponse,
	XurlReferencedTweet,
	XurlTweetData,
} from "./types";
import {
	buildExternalProfileId,
	upsertProfileFromXUser,
	upsertSparseProfileFromXUser,
} from "./x-profile";

/**
 * One-way import of a dewey-pipeline `corpus.jsonl` (bookmark records) into the
 * local store. Dewey data only fills gaps; it never overrides data a live sync
 * or the archive already holds:
 * - a tweet is upserted only when absent or still an archive stub
 *   (`profile_unknown`); otherwise only bookmark membership is added;
 * - a profile is written only when absent or not yet hydrated (no
 *   `public_metrics`), oldest observation first, before any tweet;
 * - a bookmark's existing `collected_at` and `source` are kept; a null save time
 *   is filled.
 * Authors are never resolved from the Dewey CSV handle: handles get reused.
 */

export const DEWEY_CORPUS_SOURCE = "dewey-pipeline";
const UNKNOWN_PROFILE_ID = "profile_unknown";
const DEFAULT_BATCH_SIZE = 250;

type JsonRecord = Record<string, unknown>;

export interface DeweyAuthor {
	id: string;
	username?: string | null;
	name?: string | null;
	observed_at?: string | null;
	profile?: JsonRecord | null;
}

export interface DeweyCorpusRecord {
	tweet_id: string;
	source?: string;
	csv?: JsonRecord | null;
	hydrated?: JsonRecord | null;
	bookmarked_at?: string | null;
}

export interface DeweyCorpusImportOptions {
	accountId: string;
	dryRun?: boolean;
	limit?: number;
	batchSize?: number;
	onProgress?: (processed: number) => void;
}

export interface DeweyCorpusImportResult {
	dryRun: boolean;
	accountId: string;
	recordsRead: number;
	malformedLines: number;
	tweetsUpserted: number;
	tweetsStubbed: number;
	stubMediaFilled: number;
	tweetsKept: number;
	quotedTweetsUpserted: number;
	skippedNoDate: number;
	bookmarksAdded: number;
	bookmarksSaveTimeFilled: number;
	bookmarksUnchanged: number;
	bookmarksWithSaveTime: number;
	profilesCreated: number;
	profilesUpgraded: number;
	profilesKept: number;
	sparseProfilesCreated: number;
}

function asRecord(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function compact<T extends JsonRecord>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

/** ISO 8601 from ISO or Twitter-style (`Wed Oct 10 20:19:24 +0000 2018`). */
export function toIsoDate(value: unknown): string | undefined {
	const text = str(value);
	if (!text) return undefined;
	const ms = Date.parse(text);
	return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Post time: hydrated date, then Snowflake decode, then the Dewey CSV date (naive UTC). */
export function resolveCreatedAt(
	record: DeweyCorpusRecord,
): string | undefined {
	const hydrated = toIsoDate(record.hydrated?.created_at_utc);
	if (hydrated) return hydrated;
	const snowflake = snowflakeToIso(record.tweet_id);
	if (snowflake) return snowflake;
	const csvDate = str(record.csv?.date);
	if (!csvDate) return undefined;
	return toIsoDate(
		/[zZ]|[+-]\d\d:?\d\d$/.test(csvDate) ? csvDate : `${csvDate}Z`,
	);
}

function hydratedAuthor(record: DeweyCorpusRecord): DeweyAuthor | undefined {
	const author = asRecord(record.hydrated?.author);
	const id = str(author?.id);
	return author && id && /^[0-9]+$/.test(id)
		? ({ ...author, id } as DeweyAuthor)
		: undefined;
}

export function toXurlUser(author: DeweyAuthor): XurlMentionUser {
	const profile = asRecord(author.profile) ?? {};
	const publicMetrics = compact({
		followers_count: num(profile.followers_count),
		following_count: num(profile.following_count),
		tweet_count: num(profile.tweet_count),
		listed_count: num(profile.listed_count),
	});
	return compact({
		id: author.id,
		username: str(author.username) ?? "",
		name: str(author.name) ?? str(author.username) ?? "",
		description:
			typeof profile.description === "string" ? profile.description : undefined,
		location: str(profile.location),
		url: str(profile.url),
		profile_image_url: str(profile.profile_image_url),
		created_at: toIsoDate(profile.created_at),
		protected:
			typeof profile.protected === "boolean" ? profile.protected : undefined,
		verified:
			typeof profile.is_blue_verified === "boolean"
				? profile.is_blue_verified
				: undefined,
		verified_type: str(profile.verified_type),
		public_metrics:
			Object.keys(publicMetrics).length > 0 ? publicMetrics : undefined,
	}) as XurlMentionUser;
}

function toEntities(hydrated: JsonRecord) {
	const entities = asRecord(hydrated.entities) ?? {};
	const urls = (Array.isArray(entities.urls) ? entities.urls : [])
		.map(asRecord)
		.filter((url): url is JsonRecord => Boolean(url && str(url.tco)))
		.map((url) =>
			compact({
				url: str(url.tco),
				expanded_url: str(url.unwound) ?? str(url.expanded) ?? str(url.tco),
				display_url: str(url.display),
				title: str(url.title),
				description: str(url.description),
			}),
		);
	const mentions = (Array.isArray(hydrated.mentions) ? hydrated.mentions : [])
		.map(asRecord)
		.filter((mention): mention is JsonRecord =>
			Boolean(mention && str(mention.username)),
		)
		.map((mention) =>
			compact({
				username: str(mention.username),
				id: str(mention.id),
				start: num(mention.start),
				end: num(mention.end),
			}),
		);
	const hashtags = (Array.isArray(entities.hashtags) ? entities.hashtags : [])
		.filter((tag): tag is string => typeof tag === "string" && tag !== "")
		.map((tag) => ({ tag }));
	const articleTitle = str(hydrated.article_title);
	return compact({
		urls: urls.length > 0 ? urls : undefined,
		mentions: mentions.length > 0 ? mentions : undefined,
		hashtags: hashtags.length > 0 ? hashtags : undefined,
		article: articleTitle ? { title: articleTitle } : undefined,
	});
}

function toMedia(hydrated: JsonRecord, tweetId: string): XurlMediaItem[] {
	return (Array.isArray(hydrated.media) ? hydrated.media : [])
		.map((rawItem, index) => ({ item: asRecord(rawItem), index }))
		.filter(({ item }) => Boolean(item))
		.map(({ item, index }) => {
			const mediaKey = str(item!.media_key);
			const variants = (Array.isArray(item!.variants) ? item!.variants : [])
				.map(asRecord)
				.filter((variant): variant is JsonRecord =>
					Boolean(variant && str(variant.url)),
				)
				.map((variant) =>
					compact({
						url: String(variant.url),
						content_type: str(variant.content_type) ?? "",
						bit_rate: num(variant.bit_rate) ?? num(variant.bitrate),
					}),
				);
			if (!mediaKey && variants.length === 0) {
				const videoUrl = str(item!.video_url);
				if (videoUrl)
					variants.push(
						compact({
							url: videoUrl,
							content_type: "video/mp4",
							bit_rate: undefined,
						}),
					);
			}
			return compact({
				media_key: mediaKey ?? `dewey_${tweetId}_${index}`,
				type: str(item!.type) ?? "photo",
				url: str(item!.url),
				// Legacy bird video items carry the poster JPG in `url` and the MP4
				// in `video_url`; without this the stored item points at the MP4.
				preview_image_url:
					str(item!.preview_url) ??
					(str(item!.video_url) ? str(item!.url) : undefined),
				width: num(item!.width),
				height: num(item!.height),
				duration_ms: num(item!.duration_ms),
				variants: variants.length > 0 ? variants : undefined,
			}) as XurlMediaItem;
		});
}

function stubMedia(record: DeweyCorpusRecord) {
	const media = record.hydrated
		? toMedia(record.hydrated, record.tweet_id)
		: [];
	return buildTweetMedia(
		{ attachments: { media_keys: media.map((item) => item.media_key) } },
		indexMediaIncludes(media),
	);
}

/**
 * Map a hydrated record to an xurl v2 tweet plus its media includes. Returns
 * undefined when the record has no hydrated author id (never guessed).
 */
export function toXurlTweet(
	record: DeweyCorpusRecord,
): { tweet: XurlTweetData; media: XurlMediaItem[] } | undefined {
	const hydrated = record.hydrated;
	const author = hydratedAuthor(record);
	const createdAt = resolveCreatedAt(record);
	if (!hydrated || !author || !createdAt) return undefined;
	const text = str(hydrated.full_text) ?? str(record.csv?.content) ?? "";
	const references: XurlReferencedTweet[] = [];
	const replyTo = str(hydrated.in_reply_to);
	if (replyTo) references.push({ type: "replied_to", id: replyTo });
	const quoted = str(hydrated.quoted_tweet_id);
	if (quoted) references.push({ type: "quoted", id: quoted });
	const retweeted = str(hydrated.retweeted_tweet_id);
	if (retweeted) references.push({ type: "retweeted", id: retweeted });
	const metrics = asRecord(hydrated.metrics) ?? {};
	const media = toMedia(hydrated, record.tweet_id);
	const editIds = asRecord(hydrated.edit)?.edit_history_tweet_ids;
	const bookmarkedAt = toIsoDate(record.bookmarked_at);
	const tweet = compact({
		id: record.tweet_id,
		author_id: author.id,
		text,
		note_tweet:
			hydrated.text_source === "note_tweet" && text ? { text } : undefined,
		created_at: createdAt,
		conversation_id: str(hydrated.conversation_id),
		in_reply_to_user_id: str(hydrated.in_reply_to_user_id),
		entities: toEntities(hydrated),
		referenced_tweets: references.length > 0 ? references : undefined,
		attachments:
			media.length > 0
				? { media_keys: media.map((item) => item.media_key) }
				: undefined,
		public_metrics: compact({
			reply_count: num(metrics.reply),
			retweet_count: num(metrics.retweet),
			like_count: num(metrics.like),
			quote_count: num(metrics.quote),
			bookmark_count: num(metrics.bookmark),
			impression_count: num(metrics.impression),
		}),
		edit_history_tweet_ids:
			Array.isArray(editIds) && editIds.every((id) => typeof id === "string")
				? (editIds as string[])
				: [record.tweet_id],
		bookmarked_at: bookmarkedAt,
	}) as XurlTweetData;
	return { tweet, media };
}

/** Compact quoted tweet → reference tweet; only when its author id is known. */
export function toQuotedXurlTweet(
	record: DeweyCorpusRecord,
): XurlTweetData | undefined {
	const quoted = asRecord(record.hydrated?.quoted_tweet);
	const id = str(quoted?.id);
	const authorId = str(quoted?.author_id);
	const createdAt =
		toIsoDate(quoted?.created_at) ?? (id ? snowflakeToIso(id) : null);
	if (!quoted || !id || !authorId || !/^[0-9]+$/.test(authorId) || !createdAt) {
		return undefined;
	}
	return {
		id,
		author_id: authorId,
		text: typeof quoted.text === "string" ? quoted.text : "",
		created_at: createdAt,
		edit_history_tweet_ids: [id],
	};
}

/**
 * JSONL lines split on "\n" only. node:readline also breaks on U+2028/U+2029,
 * which JSON allows raw inside strings (the real corpus has hundreds).
 */
async function* jsonlLines(corpusPath: string): AsyncGenerator<string> {
	let pending = "";
	for await (const chunk of createReadStream(corpusPath, {
		encoding: "utf8",
	})) {
		pending += chunk as string;
		let newline = pending.indexOf("\n");
		while (newline !== -1) {
			yield pending.slice(0, newline).replace(/\r$/, "");
			pending = pending.slice(newline + 1);
			newline = pending.indexOf("\n");
		}
	}
	if (pending) yield pending.replace(/\r$/, "");
}

async function* readCorpus(
	corpusPath: string,
	stats: { malformed: number },
	limit?: number,
): AsyncGenerator<DeweyCorpusRecord> {
	let yielded = 0;
	for await (const line of jsonlLines(corpusPath)) {
		if (!line.trim()) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			stats.malformed += 1;
			continue;
		}
		const record = asRecord(parsed);
		const tweetId = str(record?.tweet_id);
		if (!record || !tweetId || !/^[0-9]+$/.test(tweetId)) {
			stats.malformed += 1;
			continue;
		}
		yield { ...record, tweet_id: tweetId } as DeweyCorpusRecord;
		yielded += 1;
		if (limit !== undefined && yielded >= limit) return;
	}
}

function isHydratedProfile(rawJson: string | undefined) {
	if (!rawJson) return false;
	try {
		return Boolean(asRecord(JSON.parse(rawJson))?.public_metrics);
	} catch {
		return false;
	}
}

function emptyResult(
	accountId: string,
	dryRun: boolean,
): DeweyCorpusImportResult {
	return {
		dryRun,
		accountId,
		recordsRead: 0,
		malformedLines: 0,
		tweetsUpserted: 0,
		tweetsStubbed: 0,
		stubMediaFilled: 0,
		tweetsKept: 0,
		quotedTweetsUpserted: 0,
		skippedNoDate: 0,
		bookmarksAdded: 0,
		bookmarksSaveTimeFilled: 0,
		bookmarksUnchanged: 0,
		bookmarksWithSaveTime: 0,
		profilesCreated: 0,
		profilesUpgraded: 0,
		profilesKept: 0,
		sparseProfilesCreated: 0,
	};
}

function importProfiles(
	db: Database,
	authors: Map<string, DeweyAuthor>,
	quotedAuthors: Map<string, string>,
	result: DeweyCorpusImportResult,
	dryRun: boolean,
) {
	const selectProfile = db.prepare(
		"select raw_json from profiles where id = ?",
	);
	// Oldest observation first, so the most recent claimant of a reused handle wins.
	const ordered = [...authors.values()].sort(
		(left, right) =>
			String(left.observed_at ?? "").localeCompare(
				String(right.observed_at ?? ""),
			) || left.id.localeCompare(right.id),
	);
	const run = () => {
		for (const author of ordered) {
			const existing = selectProfile.get(buildExternalProfileId(author.id)) as
				| { raw_json: string }
				| undefined;
			if (existing && isHydratedProfile(existing.raw_json)) {
				result.profilesKept += 1;
				continue;
			}
			const user = toXurlUser(author);
			if (!user.username) {
				result.profilesKept += 1;
				continue;
			}
			if (!dryRun) upsertProfileFromXUser(db, user);
			if (existing) result.profilesUpgraded += 1;
			else result.profilesCreated += 1;
		}
		for (const [id, username] of quotedAuthors) {
			if (authors.has(id)) continue;
			if (selectProfile.get(buildExternalProfileId(id))) continue;
			if (!dryRun) upsertSparseProfileFromXUser(db, { id, username });
			result.sparseProfilesCreated += 1;
		}
	};
	if (dryRun) run();
	else db.transaction(run)();
}

function importBatch(
	db: Database,
	batch: DeweyCorpusRecord[],
	accountId: string,
	result: DeweyCorpusImportResult,
	dryRun: boolean,
	corpusTweetIds: ReadonlySet<string>,
) {
	const quotedById = new Map<string, XurlTweetData>();
	for (const record of batch) {
		const quoted = toQuotedXurlTweet(record);
		// A quoted tweet that is itself a corpus bookmark is written from its own
		// (richer) record instead, whichever batch that falls in.
		if (quoted && !corpusTweetIds.has(quoted.id))
			quotedById.set(quoted.id, quoted);
	}
	const lookupIds = [
		...new Set([...batch.map((r) => r.tweet_id), ...quotedById.keys()]),
	];
	const existing = new Map(
		(
			db
				.prepare(
					`select id, author_profile_id, media_json from tweets where id in (${lookupIds.map(() => "?").join(", ")})`,
				)
				.all(...lookupIds) as {
				id: string;
				author_profile_id: string;
				media_json: string;
			}[]
		).map((row) => [row.id, row]),
	);
	const writable = (id: string) => {
		const row = existing.get(id);
		return row === undefined || row.author_profile_id === UNKNOWN_PROFILE_ID;
	};
	const existingCollections = new Map(
		(
			db
				.prepare(
					`select tweet_id, collected_at from tweet_collections
					 where account_id = ? and kind = 'bookmarks'
					   and tweet_id in (${batch.map(() => "?").join(", ")})`,
				)
				.all(accountId, ...batch.map((r) => r.tweet_id)) as {
				tweet_id: string;
				collected_at: string | null;
			}[]
		).map((row) => [row.tweet_id, row.collected_at]),
	);

	const payloadTweets: XurlTweetData[] = [];
	const payloadMedia: XurlMediaItem[] = [];
	const stubs: {
		id: string;
		text: string;
		createdAt: string;
		mediaCount: number;
		mediaJson: string;
	}[] = [];
	const stubMediaRepairs: {
		id: string;
		mediaCount: number;
		mediaJson: string;
	}[] = [];
	const collections: {
		id: string;
		bookmarkedAt: string | null;
		raw: string;
	}[] = [];

	for (const record of batch) {
		const mapped = toXurlTweet(record);
		const media = mapped ? undefined : stubMedia(record);
		let hasTweet = existing.has(record.tweet_id);
		if (mapped && writable(record.tweet_id)) {
			payloadTweets.push(mapped.tweet);
			payloadMedia.push(...mapped.media);
			result.tweetsUpserted += 1;
			hasTweet = true;
		} else if (!hasTweet) {
			const createdAt = resolveCreatedAt(record);
			if (!createdAt) {
				result.skippedNoDate += 1;
				continue;
			}
			stubs.push({
				id: record.tweet_id,
				text: str(record.hydrated?.full_text) ?? str(record.csv?.content) ?? "",
				createdAt,
				mediaCount: media?.count ?? 0,
				mediaJson: media?.json ?? "[]",
			});
			result.tweetsStubbed += 1;
			hasTweet = true;
		} else {
			result.tweetsKept += 1;
			const existingTweet = existing.get(record.tweet_id);
			if (
				!mapped &&
				existingTweet?.author_profile_id === UNKNOWN_PROFILE_ID &&
				["", "[]", "null"].includes(existingTweet.media_json) &&
				media &&
				media.count > 0 &&
				media.json !== "[]"
			) {
				stubMediaRepairs.push({
					id: record.tweet_id,
					mediaCount: media.count,
					mediaJson: media.json,
				});
				result.stubMediaFilled += 1;
			}
		}
		const bookmarkedAt = toIsoDate(record.bookmarked_at) ?? null;
		if (bookmarkedAt) result.bookmarksWithSaveTime += 1;
		collections.push({
			id: record.tweet_id,
			bookmarkedAt,
			raw: JSON.stringify({
				source: DEWEY_CORPUS_SOURCE,
				deweySource: record.source ?? "dewey_csv",
				bookmarked_at: bookmarkedAt,
			}),
		});
		if (!existingCollections.has(record.tweet_id)) result.bookmarksAdded += 1;
		else if (existingCollections.get(record.tweet_id) == null && bookmarkedAt)
			result.bookmarksSaveTimeFilled += 1;
		else result.bookmarksUnchanged += 1;
	}
	const includedTweets = [...quotedById.values()].filter((tweet) =>
		writable(tweet.id),
	);
	result.quotedTweetsUpserted += includedTweets.length;
	if (dryRun) return;

	db.transaction(() => {
		// Quoted tweets ride as includes, so ingest even when every bookmark in
		// the batch already exists locally.
		if (payloadTweets.length > 0 || includedTweets.length > 0) {
			const payload: XurlMentionsResponse = {
				data: payloadTweets,
				includes: compact({
					tweets: includedTweets.length > 0 ? includedTweets : undefined,
					media: payloadMedia.length > 0 ? payloadMedia : undefined,
				}),
				meta: { result_count: payloadTweets.length },
			} as XurlMentionsResponse;
			// No includes.users: profiles were written (fill-only) beforehand, so
			// ingest resolves every author to its existing profile row.
			ingestTweetPayload(db, {
				accountId,
				payload,
				source: DEWEY_CORPUS_SOURCE,
			});
		}
		const insertStub = db.prepare(
			`insert into tweets (id, author_profile_id, text, created_at, media_count, media_json)
			 values (?, ?, ?, ?, ?, ?) on conflict(id) do nothing`,
		);
		for (const stub of stubs) {
			insertStub.run(
				stub.id,
				UNKNOWN_PROFILE_ID,
				stub.text,
				stub.createdAt,
				stub.mediaCount,
				stub.mediaJson,
			);
		}
		if (stubs.length > 0) {
			refreshSearchRows(
				db,
				"tweet",
				stubs.map((stub) => stub.id),
			);
		}
		const updateStubMedia = db.prepare(
			`update tweets set media_count = ?, media_json = ?
			 where id = ? and author_profile_id = ? and media_json in ('', '[]', 'null')`,
		);
		for (const repair of stubMediaRepairs) {
			updateStubMedia.run(
				repair.mediaCount,
				repair.mediaJson,
				repair.id,
				UNKNOWN_PROFILE_ID,
			);
		}
		const upsertCollection = db.prepare(
			`insert into tweet_collections (
				account_id, tweet_id, kind, collected_at, source, raw_json, updated_at
			) values (?, ?, 'bookmarks', ?, ?, ?, ?)
			on conflict(account_id, tweet_id, kind) do update set
				collected_at = coalesce(tweet_collections.collected_at, excluded.collected_at),
				updated_at = case
					when tweet_collections.collected_at is null and excluded.collected_at is not null
						then excluded.updated_at
					else tweet_collections.updated_at
				end`,
		);
		const now = new Date().toISOString();
		for (const collection of collections) {
			upsertCollection.run(
				accountId,
				collection.id,
				collection.bookmarkedAt,
				DEWEY_CORPUS_SOURCE,
				collection.raw,
				now,
			);
		}
	})();
}

export async function importDeweyCorpus(
	db: Database,
	corpusPath: string,
	options: DeweyCorpusImportOptions,
): Promise<DeweyCorpusImportResult> {
	const dryRun = Boolean(options.dryRun);
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const result = emptyResult(options.accountId, dryRun);

	// Pass 1: latest observation per author id, and quoted-tweet authors.
	const authors = new Map<string, DeweyAuthor>();
	const quotedAuthors = new Map<string, string>();
	const corpusTweetIds = new Set<string>();
	const firstPass = { malformed: 0 };
	for await (const record of readCorpus(corpusPath, firstPass, options.limit)) {
		corpusTweetIds.add(record.tweet_id);
		const author = hydratedAuthor(record);
		if (author) {
			const previous = authors.get(author.id);
			if (
				!previous ||
				String(author.observed_at ?? "") > String(previous.observed_at ?? "")
			) {
				authors.set(author.id, author);
			}
		}
		const quoted = asRecord(record.hydrated?.quoted_tweet);
		const quotedAuthorId = str(quoted?.author_id);
		const quotedUsername = str(quoted?.username);
		if (quotedAuthorId && /^[0-9]+$/.test(quotedAuthorId) && quotedUsername) {
			quotedAuthors.set(quotedAuthorId, quotedUsername);
		}
	}
	importProfiles(db, authors, quotedAuthors, result, dryRun);

	// Pass 2: tweets and bookmark membership, in batches.
	const secondPass = { malformed: 0 };
	let batch: DeweyCorpusRecord[] = [];
	const seen = new Set<string>();
	for await (const record of readCorpus(
		corpusPath,
		secondPass,
		options.limit,
	)) {
		result.recordsRead += 1;
		if (seen.has(record.tweet_id)) continue;
		seen.add(record.tweet_id);
		batch.push(record);
		if (batch.length >= batchSize) {
			importBatch(db, batch, options.accountId, result, dryRun, corpusTweetIds);
			batch = [];
			options.onProgress?.(result.recordsRead);
		}
	}
	if (batch.length > 0) {
		importBatch(db, batch, options.accountId, result, dryRun, corpusTweetIds);
		options.onProgress?.(result.recordsRead);
	}
	result.malformedLines = secondPass.malformed;
	return result;
}
