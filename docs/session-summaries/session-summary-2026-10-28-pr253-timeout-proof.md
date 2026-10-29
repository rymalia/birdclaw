---
session_id: 254a7e19-4123-47ef-9ede-10b5da3dc63b
date: 2026-10-28
time: "4:28 PM PDT – 6:54 PM PDT"
project: birdclaw
branch: dev
related_pr: 253
---

# Session Summary: proof logs for upstream PR #253

## Overview

Upstream PR [steipete/birdclaw#253](https://github.com/steipete/birdclaw/pull/253) (30s timeout for the 500-card timeline render test) was blocked by the ClawSweeper review bot with `status: 📣 needs proof`. This session captured before/after Node test runner logs that reproduce the 10s timeout on `main` and show it passing on the PR head, rewrote the PR body around that evidence, and requested a re-review. The bot re-rated the PR 5/6 ("diamond lobster"), `proof: sufficient`, `status: 👀 ready for maintainer look`. A side question about the X archive format was also answered from the repo's test fixtures.

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **Separate detached worktrees for before (`a08c264`, upstream/main = PR base) and after (`a809572`, PR head)** | The two sides differ only by the PR's 5-line change; installs and runs can't interfere with the `dev` checkout. |
| **Node v26.12.1 put explicitly on `PATH`** | nvm default is 24.22.1 (per the earlier 2026-10-28 session); the PR body cites Node 26.12.1, so proof had to run on the same version. |
| **Added CPU contention (8 busy-loop shell procs on 8 cores) after three plain full runs on `main` all passed** | The failure is load-dependent and didn't recur naturally; deliberate contention reproduces it and is disclosed in the PR body rather than presented as a natural failure. |
| **`--reporter=verbose` for the contended/after runs** | The default reporter doesn't print per-test durations; the bot asked for evidence tying the timeout to this specific workload. |
| **Disclosed the unrelated `dm-rendering.test.tsx` failure in the PR body** | It also failed in the contended `main` run; mentioning it up front prevents the maintainer from discovering it and doubting the proof. |
| **PR body edit and `@clawsweeper re-review` comment run only after explicit user go-ahead** | Outward-facing actions on an upstream repo. |

## Changes Made

| Change | Detail |
|--------|--------|
| **PR #253 body rewritten** | `gh pr edit 253 -R steipete/birdclaw --body-file …/scratchpad/pr-253-body.md`: kept original Summary/Change sections, added a Proof table and four collapsible ANSI-stripped log excerpts; verified via re-fetch. |
| **Re-review requested** | Comment `@clawsweeper re-review`: https://github.com/steipete/birdclaw/pull/253#issuecomment-6483958029 |
| **This session summary** | `docs/session-summaries/session-summary-2026-10-28-pr253-timeout-proof.md` (the only repo file changed). |

No source code changed. Scratch worktrees were created under the session scratchpad and removed with `git worktree remove --force` at the end; `git worktree list` shows only the main checkout.

## Testing / Research Performed

All runs: macOS, 8 CPUs, Node v26.12.1, `node ./scripts/run-vitest.mjs run`, fresh `bun install --frozen-lockfile` in each worktree.

| Run | 500-card case | Suite result |
|---|---|---|
| before, this file only | (default reporter; 3.13s file total) | 2/2 |
| before, full, plain ×3 | (default reporter) | 181/181 files, 1962/1962 each (117.05s, 118.72s, 186.87s) |
| **before, full, contended** | **18149ms — `Test timed out in 10000ms`** | 2 failed / 1960 passed |
| **after, full, contended** | **15189ms ✓** | 1962/1962 (315.24s) |
| after, full, no added load | 12940ms ✓ | 1962/1962 (253.06s) |
| after, this file only (verbose) | 3797ms ✓ | 2/2 |

Bot re-review result (comment updated in place): overall 5/6, proof 5/6 "Sufficient (terminal)", patch quality 5/6, Findings: none, Before merge: none.

Archive-format research: read `makeArchive()` in `src/lib/archive-import.test.ts:32-175` and `docs/archive.md`.

## Summary Statistics

- Full-suite Node runs: 6 (4 on `main`, 2 on PR head); single-file runs: 2
- Timeouts reproduced: 1 (contended `main`)
- Upstream GitHub writes: 2 (PR body edit, one comment)
- Bot rating: 1/6 → 5/6

## Discoveries / Handoff Notes

- **Second, unrelated flake:** `src/components/dm-rendering.test.tsx > does not render the loaded conversation list or messages while composing` failed under contention with `Unable to find an element with the text: New message`. That's a Testing Library `findBy` timeout (default 1000ms), separate from Vitest's `testTimeout`; it passed in both after-runs (3431ms contended, 5720ms plain). Candidate for its own PR.
- **"No added load" isn't idle:** during the plain after-run, the 500-card case took 12.9s (would have failed at 10s). macOS `StorageManagementService` / `ApplicationsStorageExtension` were each using ~60% CPU afterward, so background system load likely contributed. The PR body only says "no added load".
- **ClawSweeper mechanics:** it edits one review comment in place (created timestamp stays at the first review); re-review is triggered by `@clawsweeper re-review` from the author; it accepts terminal-log proof pasted in the PR body.
- **X archive format (no real sample on disk yet):** each `data/*.js` is `window.YTD.<slice>.partN = [ ... ]` wrapping JSON; `tweets.js` uses legacy `"Tue Jun 03 19:32:20 +0000 2025"` dates while like/bookmark/DM/note slices use ISO 8601; counts are strings; likes/bookmarks carry only `tweetId` + `fullText`. The test fixtures are hand-written mocks of the parsed fields only.
- Log files from this session remain in the session scratchpad (`…/scratchpad/logs/`), which is not durable.

## Current State

- `dev` checkout unchanged apart from this summary; only one worktree.
- PR #253: open, mergeable, labels `proof: sufficient`, `status: 👀 ready for maintainer look`, `P3`, `rating: 🦞 diamond lobster`; no maintainer review yet.

## Unfinished Work

- Wait for maintainer review/merge of PR #253.
- Optional: separate PR for the load-sensitive `dm-rendering.test.tsx` `findBy` flake.
