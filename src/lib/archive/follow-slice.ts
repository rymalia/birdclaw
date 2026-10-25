import { Effect } from "effect";
import type { ArchiveImportPlan } from "../archive-import-plan";
import { getArchiveFollowRow } from "./parsing";
import type { ArchiveProfileReconciler } from "./profile-reconciler";
import { processArchiveEntryRecordsEffect } from "./reader";
import type {
	ArchiveFollowDirection,
	ArchiveFollowKey,
	ImportProgressEvent,
} from "./types";

export function parseFollowSliceEffect({
	archivePath,
	entries,
	direction,
	plan,
	onProgress,
}: {
	archivePath: string;
	entries: string[];
	direction: ArchiveFollowDirection;
	plan: ArchiveImportPlan;
	onProgress: (event: ImportProgressEvent) => void;
}) {
	const key: ArchiveFollowKey =
		direction === "followers" ? "follower" : "following";
	const rows = direction === "followers" ? plan.followers : plan.following;
	const ids = direction === "followers" ? plan.followerIds : plan.followingIds;
	return Effect.gen(function* () {
		if (entries.length > 0) {
			onProgress({
				kind: "slice-start",
				slice: direction,
				files: entries.length,
			});
		}
		for (const [fileIndex, entry] of entries.entries()) {
			yield* processArchiveEntryRecordsEffect(archivePath, entry, (wrapper) => {
				const row = getArchiveFollowRow(wrapper, key);
				if (!row || ids.has(row.externalUserId)) return;
				ids.add(row.externalUserId);
				rows.push(row);
			});
			onProgress({
				kind: "slice-file",
				slice: direction,
				processed: fileIndex + 1,
				files: entries.length,
			});
		}
		if (entries.length > 0) {
			onProgress({ kind: "slice-done", slice: direction, count: rows.length });
		}
	});
}

export function reconcileFollowProfiles({
	plan,
	reconciler,
	includeFollowers,
	includeFollowing,
	followerEntryCount,
	followingEntryCount,
}: {
	plan: ArchiveImportPlan;
	reconciler: ArchiveProfileReconciler;
	includeFollowers: boolean;
	includeFollowing: boolean;
	followerEntryCount: number;
	followingEntryCount: number;
}) {
	for (const row of [...plan.followers, ...plan.following]) {
		reconciler.addFollowProfile(row.profileId, row.externalUserId);
	}
	const clearedDirections = new Set<ArchiveFollowDirection>();
	if (includeFollowers && followerEntryCount === 0) {
		clearedDirections.add("followers");
	}
	if (includeFollowing && followingEntryCount === 0) {
		clearedDirections.add("following");
	}
	reconciler.retainExistingFollowProfiles(clearedDirections);
}
