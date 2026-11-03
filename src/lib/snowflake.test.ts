import { describe, expect, it } from "vitest";
import {
	isEpochPlaceholder,
	snowflakeToEpochMs,
	snowflakeToIso,
} from "./snowflake";

describe("snowflakeToIso", () => {
	it("decodes the post time X documents for a known tweet", () => {
		// @Wikipedia, 2025-02-10 13:34:39.256 UTC (Wikipedia "Snowflake ID" example).
		expect(snowflakeToIso("1888944671579078978")).toBe(
			"2025-02-10T13:34:39.256Z",
		);
	});

	it("decodes early Snowflakes from November 2010", () => {
		// 15-digit IDs are real Snowflakes from the first weeks after rollout.
		const ms = snowflakeToEpochMs("100000000000000");
		expect(ms).not.toBeNull();
		expect(new Date(ms!).toISOString().slice(0, 10)).toBe("2010-11-04");
		expect(snowflakeToIso("2000000000000000")?.slice(0, 7)).toBe("2010-11");
	});

	it("refuses pre-Snowflake sequential IDs and non-numeric input", () => {
		expect(snowflakeToIso("29700859247")).toBeNull();
		expect(snowflakeToIso("17623011985")).toBeNull();
		expect(snowflakeToIso("tweet_1")).toBeNull();
		expect(snowflakeToIso("")).toBeNull();
		expect(snowflakeToIso("-5")).toBeNull();
	});
});

describe("isEpochPlaceholder", () => {
	it("recognizes only the 1970 placeholder", () => {
		expect(isEpochPlaceholder("1970-01-01T00:00:00.000Z")).toBe(true);
		expect(isEpochPlaceholder("2026-01-01T00:00:00.000Z")).toBe(false);
		expect(isEpochPlaceholder(null)).toBe(false);
		expect(isEpochPlaceholder(undefined)).toBe(false);
	});
});
