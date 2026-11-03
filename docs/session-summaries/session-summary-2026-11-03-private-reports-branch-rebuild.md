---
session_id: 11ab022e-283c-4b40-a21a-55afe45cd6db
date: 2026-11-03
time: "2026-11-02 6:48 PM PST – 2026-11-03 2:55 AM PST"
resumed: "2026-11-03 1:54 AM PST"
project: birdclaw
branch: feat/tweet-timestamps
---

# Session Summary: Private Reports Out of Git, Timestamps Branch Rebuilt

## Overview

The session's first half (Nov 2) built a private likes report from the local DB and committed its pipeline to `dev`. After resuming, I audited what that put at risk on the **public** fork, moved the report and its session summary out of the repo, and dropped the two unpushed report commits from `dev`. I also rebuilt `feat/tweet-timestamps` so it holds only its feature commit on top of `upstream/main`, verified it, and fast-forwarded local `main`. The user pushed the feature branch to the fork.

Late in the session I fact-checked a status note from a parallel session (hub session `762d0caf`, summary in the tweets repo) against the rebuilt branch. I re-ran the full suite and confirmed from the database that `repair-dates` hasn't run. That session's finding about the pre-Snowflake cutoff exposed an error in the private likes report, which I then fixed.

The start time (Nov 2, 6:48 PM PST) and the resume time (Nov 3, 1:54 AM PST) both come from the SessionStart hook. On resume the metadata collector reported only the resume time as `session_start`.

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **Keep the likes report entirely off GitHub** (user's choice, option 3 of 3) | `gh repo view` showed `rymalia/birdclaw` is PUBLIC. The report's page text and its session summary describe personal interests drawn from the likes corpus. The other options were pushing as is or keeping only a scrubbed version in the repo. |
| **Relocate to `~/.birdclaw/reports/likes-atlas/`** | It sits beside the generated report and data, under birdclaw's storage root (`BIRDCLAW_HOME`), and outside any git tree. |
| **Drop the commits instead of committing a deletion** | Both commits (`804fd26`, `49963ae`) were unpushed, so `git branch -f dev origin/dev` removes them from history completely. A deletion commit would have left the content readable in history. |
| **Rebuild `feat/tweet-timestamps` off `upstream/main`** | It had been branched from `dev`, so it was 18 commits ahead of upstream and only 1 of them was the feature. A PR from it would have carried every personal `dev` commit to steipete. |
| **Keep a local backup branch until verified, then delete it** | It was a safety net while the cherry-pick and tests were checked. The user then asked for it to be deleted. |
| **Write this summary on `dev`, not the feature branch** | The feature branch is meant to become an upstream PR. Personal session docs belong on `dev`. |

## Changes Made

| Change | Detail |
|--------|--------|
| **Report files moved out of the repo** | The 6 pipeline files were extracted from `49963ae` with `git archive`, and each copy matched its original under `cmp`. The Nov 2 session summary went into the same folder. The README and the `run.sh` usage line were updated for the new path, and the README now notes why the folder is kept out of git. |
| **`dev` reset** | `dev` → `origin/dev` (`0ba50bd`), dropping `804fd26` and `49963ae`. |
| **`feat/tweet-timestamps` rebuilt** | The old branch became `backup/tweet-timestamps-on-dev`. A new branch was made from `upstream/main` (`a08c264`) and `38251d0` cherry-picked onto it as `4d6ab05`, with no upstream set. The user then ran `git push -u origin feat/tweet-timestamps` (new branch on the fork). |
| **Backup branch deleted** | `git branch -D backup/tweet-timestamps-on-dev` (it pointed at `38251d0`). Afterwards no branch contains `804fd26`. |
| **Local `main` fast-forwarded** | `016a417` → `a08c264` via `git fetch . origin/main:main`, after confirming `main` had 0 commits of its own. |
| **Private report: pre-Snowflake cutoff corrected** | Outside the repo, in `~/.birdclaw/reports/likes-atlas/`. `compute.py` now treats only IDs ≤ `29700859247` as undatable, matching `src/lib/snowflake.ts`, instead of "fewer than 17 digits". The README notes the rule, and a correction is appended to the report's own summary. All 7 datasets were regenerated and the standalone HTML rebuilt; the old outputs were backed up to the session scratchpad first. On the live dashboard, all 7 files were re-uploaded, the datasets repointed (each `if_version`-pinned, after confirming nothing had been edited), and the 7 replaced files deleted. |
| **Memory updated** | `project-liked-tweets-atlas.md` and its `MEMORY.md` line now point to the new location and record the rule to keep this out of git. |

## Testing / Research Performed

- **Branch audit:** I fetched origin and upstream, then checked every local branch's tracking and ahead/behind state, the 3 worktrees, the merge-bases, which branches contained the report commits, and the fork's visibility. That's how I found that `feat/tweet-timestamps` was based on `dev`, and that `dev`'s source matched `upstream/main` (an empty `src` diff), so a clean cherry-pick was expected.
- **Personal-content audit** of the 3 committed report files with `git show 49963ae:<file>` and grep. No generated data files were tracked.
- **Cherry-pick fidelity:** `git show 38251d0` and `git show 4d6ab05`, ignoring `index` lines, came out IDENTICAL.
- **Rebuilt branch:** `bun run typecheck` was clean. `bun run test` over the feature's 7 test files: 7 files, 244 tests, all passed.
- **Codex luna review** (`gpt-5.6-luna`, high, read-only) of `4d6ab05` found nothing, with a SHIP verdict. It covered BigInt-safe Snowflake decoding, that the repair only touches placeholder dates and is safe to re-run with a dry run, that real dates are preserved on upsert, backup codec compatibility, and that the tests aren't tautological. It reads code only, so the pass/fail results above are from my own run.
- **Relocated pipeline:** `~/.birdclaw/reports/likes-atlas/run.sh <scratch dir>` exited 0 and reproduced all 7 datasets byte-for-byte against the saved data.
- **Before the push:** `git ls-remote` confirmed the fork had no `feat/*` or `backup/*` branches.
- **Full suite on `4d6ab05`:** `bun run check` (oxfmt, oxlint, tsc) exited 0, and `bun run test` passed 184 files and 1975/1975 tests, matching the parallel session's numbers for `38251d0`.
- **`repair-dates` status, checked read-only with sqlite3:** all 120,913 like `collected_at` values are still `1970…` placeholders, and so are 120,852 tweet `created_at` values. `birdclaw.sqlite` was last modified Oct 29 and the WAL is empty, so the repair has not run.
- **Dry-run figures reconciled:** the other session's dry run reported 120,467 / 385 / 120,913. Among placeholder tweets, 120,436 have IDs of 17+ digits and 31 have shorter IDs above the cutoff, which makes 120,467 datable. 385 are at or below the cutoff, and 120,467 + 385 = 120,852. The command's `--help` shows it **writes by default**; `--dry-run` is opt-in.
- **Corrected report run:** 120,528 dated and 385 undated (was 120,497 / 416), with the first month now 2010-11. All 7 dataset files changed. The 31 recovered likes are all from 2010–11, so no 2022-onward figure in the era write-up changed.

## Summary Statistics

- Unpushed personal commits removed from `dev`: 2
- Feature branch: 18 commits ahead of upstream → 1
- Tests run on the rebuilt branch: the 7 feature files (244 tests), then the full suite (184 files, 1975 tests), all passing; `bun run check` clean
- Private report: undated likes corrected from 416 to 385; 7 datasets re-uploaded and 7 stale files deleted
- Files relocated out of the repo: 7 (6 pipeline files + 1 summary; all byte-verified, except the README and `run.sh`, which were edited for the new path)
- Codex review passes: 1 (SHIP)

## Discoveries / Handoff Notes

- **Branching from `dev` contaminates upstream PRs.** `dev` carries personal docs (CLAUDE.md edits, session summaries). Feature branches meant for steipete must start from `upstream/main`, with `git branch --unset-upstream` right after creating them.
- **`git branch -f <b> origin/<b>` both resets a branch and restores its tracking.** It is the cleanest way to drop unpushed commits from a branch you don't have checked out.
- **On resume, the summary collector's `session_start` is the resume time.** The original start time has to come from the first SessionStart hook output.
- **The like-order lower bound applies to bird's live Likes timeline, not to `like.js`.** The parallel session's bound, like_time(i) ≥ max post_time over positions ≥ i, can't be applied to the archive: in `like.js`, tweets posted in October 2026 appear in every 10k-entry slice, so its order isn't the like order.
- **`db repair-dates` writes unless you pass `--dry-run`.** Preview first, and copy the DB before the real run.

## Current State

- Checked-out branch: switched to `dev` to write this summary. The user's working branch is `feat/tweet-timestamps`, which tracks `origin/feat/tweet-timestamps` and has no PR yet; the user is holding off because more work may go on that branch.
- `dev`: in sync with `origin/dev` before this summary's commit, so 1 ahead after it.
- `main` = `origin/main` = `upstream/main` = `a08c264`.
- Untouched: `fix/archive-media-untyped-zip-entries`, `fix/x-web-viewer-provided-variables` (both with worktrees), `test/timeline-render-timeout`.
- Private report material lives only under `~/.birdclaw/reports/`.

## Unfinished Work

- **Optional:** push this summary with `git push origin dev`.
- **When ready:** open the upstream PR from `feat/tweet-timestamps` against `steipete/birdclaw:main`. It is deferred while work may continue on the branch.
- **Pending approval, private report:** the heatmap shading fix noted in the report's own session summary under `~/.birdclaw/reports/likes-atlas/`.
- **Pending approval:** run `birdclaw db repair-dates` for real on `~/.birdclaw/birdclaw.sqlite`, after copying the DB.
- **Stale line elsewhere:** the hub summary `tweets/docs/session-summaries/session-summary-2026-11-03-timestamps-raw-first.md` still says birdclaw `feat/tweet-timestamps` is unpushed and cites `38251d0`, which is now `4d6ab05`. That's the tweets repo's file, so I didn't edit it.
