/**
 * X/Twitter Snowflake IDs: bits 63..22 are milliseconds since the X epoch.
 * https://docs.x.com/fundamentals/x-ids
 *
 * Tweet IDs became Snowflakes on 2010-11-04. Earlier IDs were sequential, and
 * decoding one yields a meaningless 2010-11-04 timestamp, so they return null.
 * User IDs switched later than tweet IDs; only decode tweet (or DM event) IDs.
 */
export const X_SNOWFLAKE_EPOCH_MS = 1288834974657n;

/** Highest pre-Snowflake tweet ID (TweetedAt, Old Dominion Univ. WS-DL, 2019). */
export const LAST_PRE_SNOWFLAKE_TWEET_ID = 29700859247n;

const DIGITS = /^\d{1,20}$/;

export function snowflakeToEpochMs(id: string): number | null {
	if (!DIGITS.test(id)) return null;
	const value = BigInt(id);
	if (value <= LAST_PRE_SNOWFLAKE_TWEET_ID) return null;
	return Number((value >> 22n) + X_SNOWFLAKE_EPOCH_MS);
}

/** Post time of a Snowflake tweet ID as ISO 8601 (ms precision), or null. */
export function snowflakeToIso(id: string): string | null {
	const ms = snowflakeToEpochMs(id);
	return ms === null ? null : new Date(ms).toISOString();
}

/** birdclaw's historical "unknown date" placeholder (`new Date(0)`). */
export function isEpochPlaceholder(value: string | null | undefined) {
	return typeof value === "string" && value.startsWith("1970-01-01");
}
