import { safeHttpUrl } from "../url-safety";
import type {
	ArchiveAccountPayload,
	ArchiveFollowKey,
	ArchiveRecord,
} from "./types";

export function parseTwitterDate(value: unknown) {
	if (typeof value !== "string" || value.length === 0) {
		return new Date(0).toISOString();
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime())
		? new Date(0).toISOString()
		: parsed.toISOString();
}

export function compareIsoTimestamp(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function asArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

export function toInt(value: unknown) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function getTweetMediaCount(tweet: Record<string, unknown>) {
	const entities = asRecord(tweet.entities);
	const extendedEntities = asRecord(tweet.extended_entities);
	return Math.max(
		asArray(entities?.media).length,
		asArray(extendedEntities?.media).length,
	);
}

function toFiniteNumber(value: unknown) {
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function archiveHttpUrl(value: unknown) {
	return safeHttpUrl(typeof value === "string" ? value : String(value ?? ""));
}

export function extractTweetEntities(tweet: Record<string, unknown>) {
	const entities = asRecord(tweet.entities);
	const urlEntries = [
		...asArray<Record<string, unknown>>(entities?.urls),
		...asArray<Record<string, unknown>>(entities?.media),
	];
	const seenUrls = new Set<string>();
	const urls = urlEntries
		.map((entry) => ({
			url: archiveHttpUrl(entry.url) ?? "",
			expandedUrl:
				archiveHttpUrl(entry.expanded_url ?? entry.expandedUrl ?? entry.url) ??
				"",
			displayUrl: String(
				entry.display_url ??
					entry.displayUrl ??
					entry.expanded_url ??
					entry.url ??
					"",
			),
			start: Number(asArray<number>(entry.indices)[0] ?? 0),
			end: Number(asArray<number>(entry.indices)[1] ?? 0),
			title: typeof entry.title === "string" ? entry.title : undefined,
			description:
				typeof entry.description === "string" ? entry.description : null,
			imageUrl:
				archiveHttpUrl(
					entry.image_url ??
						entry.imageUrl ??
						entry.thumbnail_url ??
						entry.media_url_https ??
						entry.media_url,
				) ?? undefined,
			siteName:
				typeof entry.site_name === "string"
					? entry.site_name
					: typeof entry.siteName === "string"
						? entry.siteName
						: undefined,
		}))
		.filter((entry) => entry.url.length > 0 || entry.expandedUrl.length > 0)
		.filter((entry) => {
			const key = `${entry.start}:${entry.end}:${entry.url}:${entry.expandedUrl}`;
			if (seenUrls.has(key)) return false;
			seenUrls.add(key);
			return true;
		});
	const mentions = asArray<Record<string, unknown>>(entities?.user_mentions)
		.map((entry) => ({
			username: String(entry.screen_name ?? ""),
			id: String(entry.id_str ?? entry.id ?? ""),
			start: Number(asArray<number>(entry.indices)[0] ?? 0),
			end: Number(asArray<number>(entry.indices)[1] ?? 0),
		}))
		.filter((entry) => entry.username.length > 0);
	const hashtags = asArray<Record<string, unknown>>(entities?.hashtags)
		.map((entry) => ({
			tag: String(entry.text ?? ""),
			start: Number(asArray<number>(entry.indices)[0] ?? 0),
			end: Number(asArray<number>(entry.indices)[1] ?? 0),
		}))
		.filter((entry) => entry.tag.length > 0);

	return {
		...(urls.length > 0 ? { urls } : {}),
		...(mentions.length > 0 ? { mentions } : {}),
		...(hashtags.length > 0 ? { hashtags } : {}),
	};
}

function archiveMediaType(value: unknown) {
	const type = String(value ?? "image");
	return type === "photo"
		? "image"
		: type === "video" || type === "animated_gif"
			? type === "animated_gif"
				? "gif"
				: "video"
			: "unknown";
}

function archiveMediaSize(entry: Record<string, unknown>) {
	const sizes = asRecord(entry.sizes);
	const large = asRecord(sizes?.large);
	const largeWidth = toFiniteNumber(large?.w ?? large?.width);
	const largeHeight = toFiniteNumber(large?.h ?? large?.height);
	if (largeWidth !== undefined && largeHeight !== undefined) {
		return { width: largeWidth, height: largeHeight };
	}
	return Object.values(sizes ?? {})
		.map((size) => asRecord(size))
		.map((size) => ({
			width: toFiniteNumber(size?.w ?? size?.width),
			height: toFiniteNumber(size?.h ?? size?.height),
		}))
		.filter(
			(size): size is { width: number; height: number } =>
				size.width !== undefined && size.height !== undefined,
		)
		.sort(
			(left, right) => right.width * right.height - left.width * left.height,
		)[0];
}

function archiveMp4Variants(entry: Record<string, unknown>) {
	const videoInfo = asRecord(entry.video_info);
	return asArray<Record<string, unknown>>(videoInfo?.variants)
		.filter(
			(variant) =>
				variant.content_type === "video/mp4" && typeof variant.url === "string",
		)
		.map((variant) => {
			const bitRate = toFiniteNumber(variant.bitrate ?? variant.bit_rate);
			return {
				url: String(variant.url),
				contentType: String(variant.content_type),
				...(bitRate !== undefined ? { bitRate } : {}),
			};
		})
		.sort(
			(left, right) => Number(right.bitRate ?? 0) - Number(left.bitRate ?? 0),
		);
}

export function extractTweetMedia(tweet: Record<string, unknown>) {
	const extendedEntities = asRecord(tweet.extended_entities);
	const entities = asRecord(tweet.entities);
	const sourceMedia = [
		...asArray<Record<string, unknown>>(extendedEntities?.media),
		...asArray<Record<string, unknown>>(entities?.media),
	];
	const seen = new Set<string>();
	return sourceMedia
		.map((entry) => {
			const url =
				archiveHttpUrl(entry.media_url_https ?? entry.media_url ?? entry.url) ??
				"";
			const thumbnailUrl =
				archiveHttpUrl(entry.media_url_https ?? entry.media_url ?? url) ?? url;
			const videoInfo = asRecord(entry.video_info);
			const durationMs = toFiniteNumber(videoInfo?.duration_millis);
			const variants = archiveMp4Variants(entry);
			return {
				url,
				type: archiveMediaType(entry.type),
				altText:
					typeof entry.ext_alt_text === "string"
						? entry.ext_alt_text
						: undefined,
				thumbnailUrl,
				...archiveMediaSize(entry),
				...(durationMs !== undefined ? { durationMs } : {}),
				...(variants.length > 0 ? { variants } : {}),
			};
		})
		.filter((entry) => {
			if (!entry.url || seen.has(entry.url)) return false;
			seen.add(entry.url);
			return true;
		});
}

export function extractCollectionTweet(
	wrapper: ArchiveRecord,
	key: "like" | "bookmark",
) {
	const entry = asRecord(wrapper[key]) ?? asRecord(wrapper.tweet);
	if (!entry) return null;
	const id = String(
		entry.tweetId ?? entry.tweet_id ?? entry.id_str ?? entry.id ?? "",
	);
	if (!id) return null;
	return {
		id,
		text: String(
			entry.fullText ??
				entry.full_text ??
				entry.text ??
				entry.expandedUrl ??
				entry.expanded_url ??
				"",
		),
		createdAt: parseTwitterDate(
			entry.likedAt ??
				entry.bookmarkedAt ??
				entry.createdAt ??
				entry.created_at ??
				new Date(0).toISOString(),
		),
		likeCount: toInt(entry.favorite_count ?? entry.like_count),
	};
}

export function buildAccountPayload(
	accountRecord: ArchiveRecord | null,
	profileRecord: ArchiveRecord | null,
): ArchiveAccountPayload {
	const account = asRecord(accountRecord?.account);
	const profile = asRecord(profileRecord?.profile);
	const description = asRecord(profile?.description);
	return {
		accountId: String(account?.accountId ?? "unknown"),
		username: String(account?.username ?? "unknown"),
		displayName: String(
			account?.accountDisplayName ??
				account?.name ??
				account?.username ??
				"Unknown",
		),
		createdAt: parseTwitterDate(account?.createdAt),
		bio: String(description?.bio ?? ""),
	};
}

export function inferProfileFromDirectory(
	userId: string,
	directory: Map<string, { handle?: string; displayName?: string }>,
) {
	const match = directory.get(userId);
	const handle = match?.handle?.replace(/^@/, "") || `id${userId}`;
	return { handle, displayName: match?.displayName || handle };
}

export function getArchiveFollowRow(
	wrapper: ArchiveRecord,
	key: ArchiveFollowKey,
) {
	const item = asRecord(wrapper[key]);
	const externalUserId = String(item?.accountId ?? "");
	return externalUserId
		? { profileId: `profile_user_${externalUserId}`, externalUserId }
		: undefined;
}
