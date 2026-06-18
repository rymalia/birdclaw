import { Effect } from "effect";
import type { ArchiveImportPlan } from "../archive-import-plan";
import { extractCollectionTweet } from "./parsing";
import { processArchiveEntryRecordsEffect } from "./reader";
import type { ImportProgressEvent } from "./types";

export function parseCollectionSliceEffect({
	archivePath,
	entries,
	kind,
	plan,
	onProgress,
}: {
	archivePath: string;
	entries: string[];
	kind: "like" | "bookmark";
	plan: ArchiveImportPlan;
	onProgress: (event: ImportProgressEvent) => void;
}) {
	return Effect.gen(function* () {
		const slice = kind === "like" ? "likes" : "bookmarks";
		if (entries.length > 0) {
			onProgress({ kind: "slice-start", slice, files: entries.length });
		}
		let count = 0;
		for (const [fileIndex, entry] of entries.entries()) {
			yield* processArchiveEntryRecordsEffect(archivePath, entry, (wrapper) => {
				count += 1;
				const tweet = extractCollectionTweet(wrapper, kind);
				if (!tweet) return;
				plan.collections.push({
					tweetId: tweet.id,
					kind: slice,
					collectedAt: tweet.createdAt,
					source: "archive",
					rawJson: JSON.stringify(wrapper),
				});
				plan.addTweet({
					id: tweet.id,
					kind,
					authorProfileId: "profile_unknown",
					text: tweet.text,
					createdAt: tweet.createdAt,
					isReplied: 0,
					replyToId: null,
					likeCount: tweet.likeCount,
					mediaCount: 0,
					bookmarked: kind === "bookmark" ? 1 : 0,
					liked: kind === "like" ? 1 : 0,
					entitiesJson: "{}",
					mediaJson: "[]",
					quotedTweetId: null,
				});
			});
			onProgress({
				kind: "slice-file",
				slice,
				processed: fileIndex + 1,
				files: entries.length,
			});
		}
		if (entries.length > 0) {
			onProgress({ kind: "slice-done", slice, count });
		}
		return count;
	});
}
