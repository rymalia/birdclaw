// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildMediaJsonFromIncludes, countTweetMedia } from "./media-includes";
import type { XurlMediaItem } from "./types";

const photo: XurlMediaItem = {
	media_key: "photo_1",
	type: "photo",
	url: "https://pbs.twimg.com/media/photo_1.jpg",
	alt_text: "diagram",
	width: 1200,
	height: 800,
};
const video: XurlMediaItem = {
	media_key: "video_1",
	type: "video",
	preview_image_url: "https://pbs.twimg.com/ext_tw_video_thumb/v.jpg",
	duration_ms: 46947,
	variants: [
		{
			url: "https://video.twimg.com/low.mp4",
			content_type: "video/mp4",
			bit_rate: 832000,
		},
		{
			url: "https://video.twimg.com/high.mp4",
			content_type: "video/mp4",
			bit_rate: 2176000,
		},
		{
			url: "https://video.twimg.com/playlist.m3u8",
			content_type: "application/x-mpegURL",
		},
	],
};
const gif: XurlMediaItem = {
	media_key: "gif_1",
	type: "animated_gif",
	preview_image_url: "https://pbs.twimg.com/tweet_video_thumb/g.jpg",
	variants: [
		{ url: "https://video.twimg.com/gif.mp4", content_type: "video/mp4" },
	],
};

function media(keys: string[], includes: XurlMediaItem[]) {
	return JSON.parse(
		buildMediaJsonFromIncludes({ attachments: { media_keys: keys } }, includes),
	);
}

describe("media includes mapping", () => {
	it("serializes photos", () => {
		expect(media(["photo_1"], [photo])).toEqual([
			{
				url: photo.url,
				type: "image",
				altText: "diagram",
				width: 1200,
				height: 800,
			},
		]);
	});

	it("serializes video mp4 variants in highest bitrate order", () => {
		expect(media(["video_1"], [video])[0]).toMatchObject({
			url: video.preview_image_url,
			type: "video",
			thumbnailUrl: video.preview_image_url,
			durationMs: 46947,
			variants: [
				{ url: "https://video.twimg.com/high.mp4", bitRate: 2176000 },
				{ url: "https://video.twimg.com/low.mp4", bitRate: 832000 },
			],
		});
	});

	it("serializes animated gifs as local gif media with mp4 variants", () => {
		expect(media(["gif_1"], [gif])[0]).toMatchObject({
			url: gif.preview_image_url,
			type: "gif",
			variants: [{ url: "https://video.twimg.com/gif.mp4" }],
		});
	});

	it("preserves mixed media order from tweet attachments", () => {
		expect(
			media(["video_1", "photo_1"], [photo, video]).map(
				(item: { type: string }) => item.type,
			),
		).toEqual(["video", "image"]);
	});

	it("returns empty JSON when there are no media keys", () => {
		expect(buildMediaJsonFromIncludes({}, [])).toBe("[]");
		expect(countTweetMedia({})).toBe(0);
	});

	it("skips dangling media keys but still counts them as tweet media", () => {
		const tweet = { attachments: { media_keys: ["missing"] } };
		expect(buildMediaJsonFromIncludes(tweet, [])).toBe("[]");
		expect(countTweetMedia(tweet)).toBe(1);
	});
});
