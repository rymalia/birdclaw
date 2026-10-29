---
session_id: dfdd5f3e-e063-4890-919b-ba6eb2e41bbf
date: 2026-10-29
time: "2026-10-28 8:31 PM PDT – 2026-10-29 4:42 AM PDT"
resumed: "2026-10-29 3:45 AM PDT"
project: birdclaw
branch: dev
related_pr: 254
---

# Session Summary — X archive import + archive-media fix (PR #254)

## Overview

Imported the user's real X archive (@ryanmalia, id 16281489) into a fresh `~/.birdclaw` database, replacing the demo seed. The first import silently copied zero media files. The cause was a zip-listing filter that drops every entry of an X-exported zip. I fixed it on a branch off `upstream/main` with a regression test and two Codex review passes, re-imported to recover all ~450 media files, and opened upstream PR [#254](https://github.com/steipete/birdclaw/pull/254) with before/after proof. ClawSweeper rated it 5/6 with no findings.

> Timestamp note: the metadata collector reported `session_start` = `2026-10-29 03:45 AM PDT`, which is the resume time; the hook value was overwritten on resume. The start time above comes from the original SessionStart hook output earlier in this session (`SESSION_START_TIME=2026-10-28 08:31 PM PDT`).

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **Rename the demo DB aside instead of deleting it** (`birdclaw.demo.sqlite` + `-shm`/`-wal`) | Reversible; the plan in the earlier memory note; the demo DB held a fake account that live syncs had already misfiled into. |
| **Import straight from the `.zip`** | The importer streams entries with `unzip -p`, so unzipping in Downloads wasn't needed. |
| **Fix in a separate worktree off `upstream/main`** (`../birdclaw-archive-media`, tracking unset) | It's an upstream bug, so it goes upstream through a PR. `dev` holds personal docs and must not carry source edits (user's fork-only flow). |
| **One-character fix: accept `?` in the mode filter** rather than removing the type check | Header/footer lines are already excluded by `parts.length >= 10`; directories by the trailing-`/` check in `media.ts`; special Unix types (`l/b/c/p/s`) should stay excluded. Smallest change that restores the contract. |
| **Test via a real zip with cleared file-type bits, run through real `unzip`** | A parser test on pasted strings would be close to tautological. Patching the central directory reproduces X's actual format end to end, and the test fails on `main`. |
| **Rewrite the test helper to walk the central directory via the EOCD record** | Codex pass 1 (P2) showed the byte scan for `PK\x01\x02` could patch filename bytes. Pass 2 confirmed the rewrite: SHIP. |
| **Re-import with `--select tweets,directMessages,profiles`** from the fix worktree | There's no media-only slice. Media is resolved from disk by tweet id (`media-fetch.ts`), so extracting the files is all that's needed, and merge mode is safe to repeat. |
| **PR proof modeled on PR #253's ClawSweeper feedback** | #253's first review said "needs real behavior proof". So #254 included shipped-entry-point (`node bin/birdclaw.mjs`) before/after runs on pinned SHAs, the environment, raw output, and provenance from the start. It used a synthetic archive with placeholder ids so none of the user's data went public (cf. steipete's #249 neutral-fixtures change). |
| **Report the Node-suite flake honestly in the PR** | The unloaded Node 26 run hit the same 500-card timeout that #253 fixes; the PR says so and links #253 rather than hiding it. |
| **Add a CHANGELOG line with the PR number in a follow-up commit** | Contributor PRs (e.g. #231) credit themselves under Unreleased; the number only exists after the PR is opened. |

## The Bug

X's archive exporter records Unix permission bits but **no file-type bits** in each zip entry's external attributes. As a result `unzip -Z -l` prints the mode column with `?` (`?rw-------` for files, `?rwx------` for directories) for all 6,754 entries in the real archive. `listArchiveEntryDetailsEffect` (`src/lib/archive/reader.ts`) kept only lines matching `/^[-d]/`, so it dropped every entry, and `extractArchiveMediaFilesEffect` copied nothing. The import still reported `ok: true` with all `mediaFiles` counts at 0. Text slices were unaffected because they're listed via `unzip -Z1` (bare paths).

Provenance: the filter arrived with archive media extraction in `0a3359d` (2026-05-12) and moved into `reader.ts` in `0ff0317` (2026-06-18). Its fixtures are built with Info-ZIP `zip`, which always sets file-type bits, so the X-style case was never exercised.

## Changes Made

| Change | Detail |
|--------|--------|
| **Real archive imported** | `~/.birdclaw/birdclaw.sqlite` (new): 3,121 authored tweets (2009-08-09 → 2026-10-28), 120,913 likes, 0 bookmarks (X archives don't include them), 126 DM conversations / 804 messages, 6,013 profiles, 555 followers, 5,623 following. The first import took 12m08s. |
| **Demo DB set aside** | `~/.birdclaw/birdclaw.demo.sqlite` (+ `-shm`, `-wal`) |
| **Archive media recovered** | `~/.birdclaw/media/originals/archive/`: 425 tweet, 20 DM, 2 profile files (453 MB). That's every file in those zip folders: the folder entry counts were 426 / 21 / 3, each including the directory entry itself. |
| **Fix** | `src/lib/archive/reader.ts`: filter `/^[-d]/` → `/^[-d?]/`, plus a comment. Commit `326efad` on `fix/archive-media-untyped-zip-entries`. |
| **Regression test** | `src/lib/archive-import.test.ts`: `clearZipEntryFileTypeBits()` helper (EOCD-based central-directory walk) and the test "extracts media from archives whose entries lack file-type bits". Same commit. |
| **CHANGELOG** | `CHANGELOG.md` 0.16.4 Unreleased entry crediting #254. Commit `cdd4f0e`. |
| **Upstream PR** | [steipete/birdclaw#254](https://github.com/steipete/birdclaw/pull/254) opened; body later edited to note that `cdd4f0e` is changelog-only. The user pushed both commits. |
| **Memory** | `project-pending-x-archive.md` and its `MEMORY.md` line rewritten: archive and media imported, fix is PR #254, live smoke tests still pending. |

## Testing / Research Performed

- **Real-archive verification:** checked the `account.js` owner before importing. After the import, SQLite counts matched the import summary (tweets 123,973 total; likes 120,913; authored 3,121; DMs 804; profiles 6,013). After the re-import, those counts were unchanged and the media file counts matched the zip folders. Spot-checked that media dir `1007150179953197057` matches a tweet in the DB.
- **Root cause reproduced** by inspecting `unzip -Z -l` output: all 6,754 entries start with `?`. Compared against a `zip`-built zip, whose entries start with `-`/`d`.
- **Regression test:** fails without the fix (`expected +0 to be 1` on `mediaFiles.tweets`, checked by stashing `reader.ts`) and passes with it. `archive-import.test.ts`: 53/53 on Bun and on `test:node`.
- **Shipped-CLI proof:** built both `main@a08c264` (temporary detached worktree, since removed) and the branch under Node v26.12.1, then ran `node bin/birdclaw.mjs --json import archive` on a synthetic X-style zip. Before: `mediaFiles.tweets/dms = 0/0`, no files. After: 1/1, both files extracted.
- **Full suites:**
  - Concurrent with the re-import and Codex: Bun 1960/1963. The 3 timeouts (`timeline-rendering`, `db`, `read-only-deployment`) passed when rerun alone (28/28).
  - An early "Node" run passed 1963/1963 but actually ran under **Node v24.22.1** (nvm default); corrected in the session.
  - Unloaded, Node 26 + Bun 1.4.4: Bun 1963/1963; Node v26.12.1 1962/1963. The one failure was the 500-card timeline case timing out (22044ms), the flake PR #253 addresses.
- **`bun run check`** (oxfmt, oxlint, tsc): pass.
- **Codex reviews (gpt-5.6-luna, xhigh, read-only):**
  - Pass 1: no production issue; one P2 on the test helper's byte scan; verdict FIX.
  - Pass 2, on the rewritten helper: no findings; verdict SHIP.
- **Upstream expectations research:** read PR #253's ClawSweeper review history, contributor PR #231's files (it adds its own CHANGELOG line), recent merged PRs, and the CHANGELOG format.

## Summary Statistics

- Source files changed upstream: 2 (`reader.ts` +3/−1 incl. comment, `archive-import.test.ts` +58), plus `CHANGELOG.md` +2.
- Commits: 2 on the fix branch (`326efad`, `cdd4f0e`), plus this summary on `dev`.
- Bugs fixed: 1 (silent zero-media archive import).
- Codex review passes: 2.
- PRs opened: 1 (#254); PRs status-checked: 2 (#253, #254).
- Records imported: ~124k tweets, 120,913 likes, 804 DMs, 6,013 profiles, 6,178 follow edges; 447 media files.

## Discoveries / Handoff Notes

- **ClawSweeper** (a Codex bot) reviews every PR to steipete/birdclaw, scoring proof, patch quality and readiness out of 6. It wants shipped-entry-point before/after runs on pinned SHAs, exact commands, the environment, and raw output in `<details>` blocks. It also checks provenance. `@clawsweeper re-review` triggers a fresh review. #254 got 5/6 on its first pass.
- **CI on fork PRs is `action_required`:** GitHub holds the workflows until steipete approves them, which is why both PRs show "unstable". It's not a failure.
- **nvm's default is Node 24**, but the repo requires Node ≥26.5.1. Run `source ~/.nvm/nvm.sh && nvm use 26` before `test:node` or `node bin/birdclaw.mjs`, or the results come from the wrong runtime.
- **`sqlite3 -readonly` on `~/.birdclaw/birdclaw.sqlite`** failed with `unable to open database file (14)`, and so did `?mode=ro`. A plain `sqlite3` connection works for read queries.
- **The archive importer has no media-only slice.** Recovering media means re-running the `tweets` / `directMessages` / `profiles` slices; merge mode is safe to repeat.
- **`listArchiveEntryDetailsEffect` joins `parts.slice(9)` with single spaces**, so a filename containing runs of spaces would be mangled. Not observed in X archives; noted, not fixed.
- **`dev` lacks the fix** until #254 merges and `dev` is synced. Importing another archive from the main checkout before then would again skip media; use the fix worktree.

## Current State

- `~/.birdclaw/birdclaw.sqlite` holds the real archive and media. `birdclaw.demo.sqlite` is discardable, and so is the unzipped archive folder in `~/Downloads/X-twitter-account-data-downloads/`.
- Worktree `/Users/rymalia/projects/birdclaw-archive-media` on `fix/archive-media-untyped-zip-entries` @ `cdd4f0e`, tracking `origin`, pushed. `node_modules` is a symlink to the main checkout's. It contains a `dist/` build from the proof run.
- PR #253 (head `a809572`) and PR #254 (head `cdd4f0e`): open, mergeable, GitGuardian passed, ClawSweeper 5/6 "ready for maintainer look", CI awaiting maintainer approval. Upstream `main` is still `a08c264`.
- #254's ClawSweeper verdict is pinned to `326efad`, before the changelog-only commit.

## Live checks and the first bookmark sync, explained

These were "open questions" added after the session. The smoke tests were then run; see **Smoke test results** below. The first real bookmark sync has not been run.

### What the live smoke tests are

Small, deliberately capped reads against X. They prove that each transport works end to end on the real database: authentication, the account-identity guard, normalization, and the SQLite write. They're the leftover step from the 2026-10-27 setup session (`session-summary-2026-10-27-node26-bird-xurl-setup.md`), where they stopped because `~/.birdclaw` held the demo seed. None of them writes to X; each one only reads from X and writes into local SQLite.

| Check | What it does | What "pass" looks like | Cost / risk |
|---|---|---|---|
| **Bookmarks** `sync bookmarks --mode auto --limit 5 --max-pages 1 --refresh --json` | Fetches **one page of 5** of your most recent bookmarks. In `auto`, bookmarks try xurl first (official X v2 API, OAuth2), then fall back to bird (cookie-based web GraphQL). `--refresh` skips the 120 s live cache. `--max-pages 1` turns on paging but caps it at one page. Before writing, the guard in `live-sync-engine.ts:114` checks that the user X says you're logged in as matches the local account's external id. On 2026-10-27 this is the step that refused (`bird is authenticated as user 16281489; refusing to sync into acct_primary (25401953)`), because the local account was the demo's. Now the account is 16281489, so it should pass. | `ok: true`, a `source` of `xurl` (or `bird` on fallback), 5 tweets, plus a `next_token` showing more pages exist. `search tweets --bookmarked` should then return those 5. | Through xurl, about 5 "Owned Read" posts at $0.001 each, so roughly half a cent (per `~/projects/x-api/docs/x-api-cost-guide.md`). Through bird it's an unofficial web endpoint, so no API bill. |
| **Mention threads** `sync mention-threads --mode auto --limit 1 --max-pages 1 --json` | Takes your most recent mention and fetches its conversation (xurl first) so the thread is stored locally. It passed on 2026-10-27, but against the demo account; this rerun proves it works on the real one. | `ok: true, threads: 1, succeeded: 1` | A handful of post reads. These are *other people's* tweets, so they bill at the unowned rate ($0.005 each). |
| **DMs (web)** `dms sync --mode web --inbox accepted --limit 1 --max-pages 0 --refresh --json` | Reads your **accepted** DM inbox through birdclaw's native web transport (`x-web-dms.ts`). It makes direct `fetch` calls to x.com using the `AUTH_TOKEN` and `CT0` cookie values from your environment; it never reads your browser's cookie store. `--max-pages 0` means only the initial inbox fetch, with no extra pages (`x-web-dms.ts:250`). New messages are upserted into `dm_messages` by id, alongside the 804 imported from the archive. This is the one transport that hasn't been exercised at all. | `ok: true` with conversations and messages that match what you see on x.com; `dms list` shows them. | No API bill (it's the web API, not v2), but it acts as your logged-in session. Treat `AUTH_TOKEN` like a password: export it only in the shell running the command, and don't put it in a file in the repo. **Avoid** `dms accept`, `dms reject` and `dms block`, which change things on X. |

How to get `AUTH_TOKEN` / `CT0`: in a browser logged into x.com, open DevTools → Application → Cookies → `https://x.com` and copy the `auth_token` and `ct0` values. Then run `export AUTH_TOKEN=… CT0=…` in the shell, or with `! export …` in Claude Code, before running the command.

### What the first real bookmark sync is

X archives don't include bookmarks (the archive had no bookmarks file), so the database has **0 bookmarks** right now. The smoke test above fetches only 5. The "first real sync" is a deliberate, bounded backfill that pulls in as much of your bookmark history as X will return:

```
bun run cli sync bookmarks --mode auto --limit 100 --max-pages 20 --early-stop --refresh --json
```

- **Pages:** xurl caps bookmark pages at **90** results, whatever `--limit` says (`BOOKMARKS_MAX_RESULTS_CAP` in `xurl.ts:32`, a workaround for an X pagination bug). So 20 pages is at most about 1,800 bookmarks. `--max-pages` is the hard limit on spend.
- **What gets written:** each bookmarked tweet lands once in the canonical `tweets` table (new or merged by id), with a `bookmark` row in `tweet_collections` for your account. Authors' profiles are filled in or updated as well. A tweet you already have, because you liked it or wrote it, gets a bookmark row; it isn't stored a second time.
- **`--early-stop`:** stops at the first page where every tweet is already local. On this first run that never happens, so `--max-pages` is the effective limit. On later runs it's the cheap way to pick up only new bookmarks, usually one page (`docs/sync.md`).
- **Resuming:** if 20 pages isn't enough, copy `payload.meta.next_token` from the output into `--pagination-token` on the next run, which needs `--mode xurl`.
- **How far back:** X's bookmarks API may only expose a recent window. X's own docs have cited the most recent 800, which isn't verified here. The sync will show where pagination runs out.
- **Cost:** through xurl, bookmark reads are Owned Reads at about $0.001 per post, so a full 1,800 is about $1.80. Expansions such as author and media are free until 2026-11-22, after which they bill too, so it's cheaper to run before then.
- **Why it matters:** `search tweets --bookmarked`, the web UI's bookmark views, and `birdclaw research` (a markdown brief built from bookmarks plus their threads) all read bookmarks from the local database. Until this runs they find nothing. Run `sync bookmarks` first, then `research` (see `docs/research.md`).
- **Unverified:** whether a sync removes local bookmarks you've since un-bookmarked on X was not checked this session.

## Smoke test results (2026-10-29, after the summary was first written)

All run under Node v26.12.1 against the real `~/.birdclaw` DB.

| Check | Result |
|---|---|
| `sync bookmarks --mode auto --limit 5 --max-pages 1 --refresh --json` | **Pass.** `ok: true, source: xurl, count: 5`, with a `next_token` (more pages exist). The account guard accepted the real account. `tweet_collections` now has 5 `bookmark` rows. |
| `sync mention-threads --mode auto --limit 1 --max-pages 1 --json` | First run: `ok: true` but `mentions: 0`. It works from **locally stored mentions**, and archives contain none. After `sync mentions --latest --limit 5 --max-pages 1 --refresh --json` (xurl, 3 mentions, exit **5** = partial, more pages remain), the rerun **passed**: `mentions: 1, succeeded: 1, mergedTweets: 1`. |
| `dms sync --mode web --inbox accepted --limit 1 --max-pages 0 --refresh --json` | **Failed on upstream code** with `X web request failed (HTTP 422)`, which turned out to be a second upstream bug (below). **Passed with the fix:** `ok: true, source: web, conversations: 1, messages: 1`. `dm_messages` stayed at 804, because the newest message (2026-09-26) was already in the archive and was updated in place by its id. |

Notes:
- `! export AUTH_TOKEN=… CT0=…` in Claude Code does **not** carry over to later Bash tool calls, since each call starts a fresh shell. The cookies had to be passed inline on each command.
- The cookie values now appear in this session's transcript. If that's a concern, log out of x.com in that browser (or end the session), which invalidates `auth_token`.

## Second bug: web DM account check sends a stale Relay variable

The native web transport (`src/lib/x-web.ts`) verifies the account with X's GraphQL `viewerQuery` before any DM request. It hardcoded the provided variable `__relay_internal__pv__appviewerisloggedinprovider`. X's current bundle (`startup-*.js`, viewerQuery id `Ouqgpqn9ihXpKGhjVeQPoQ`) declares `providedVariables:{__relay_internal__pv__xclientsfeaturesappviewerisloggedinrelayprovider:Ed}`, so X returns `422 GRAPHQL_VALIDATION_FAILED "must be defined"`. That breaks every `dms sync --mode web`.

How it was diagnosed: a scratch script wrapped `fetch` to log each request's path and status (never headers), then crawled X's web modules to find the viewerQuery operation definition. The hardcoded variable came in with #209 (`368f569`).

The fix is commit `f78c167` on `fix/x-web-viewer-provided-variables` (worktree `/Users/rymalia/projects/birdclaw-xweb-viewer`, based on `upstream/main`, tracking unset, **not pushed**):
- Provider names are now read from the viewerQuery's `providedVariables` during the existing public-client discovery and each is sent as `true`. If a bundle declares none, it falls back to the current known name.
- Codex pass 1 returned FIX: P1, the id/name match could span into a neighbouring operation; P2, a 422 didn't clear the cached client; P2, missing tests. All three were addressed. Pass 2 returned SHIP with no findings.
- Two new tests, plus one updated expectation. Each new test fails with its fix removed.
- Test results: `check` clean; Node 26.12.1 1964/1964; Bun 1.4.4 1964/1964.
- Shipped-CLI before/after against the real account: `main@a08c264` exits 1 with HTTP 422; `f78c167` exits 0 with `ok: true, source: web`.
- The PR body is drafted at `/private/tmp/claude-501/-Users-rymalia-projects-birdclaw/dfdd5f3e-e063-4890-919b-ba6eb2e41bbf/scratchpad/pr-body-xweb.md`; it contains no credentials or personal ids.

## Issues & PRs

- https://github.com/steipete/birdclaw/pull/254 — opened this session (the archive-media fix)
- https://github.com/steipete/birdclaw/pull/253 — status checked only (opened in a prior session)
- Web DM viewerQuery fix — branch pushed later in the session; PR not yet opened (see the wrap-up summary)

## Unfinished Work

- **Push `fix/x-web-viewer-provided-variables`** (`git -C ~/projects/birdclaw-xweb-viewer push -u origin fix/x-web-viewer-provided-variables`). Then open the PR with the drafted body, and add a CHANGELOG commit referencing its number (a second push).
- **Until that fix merges**, run web DM reads from the `birdclaw-xweb-viewer` worktree; `dev` still has the broken variable.
- **First real bookmark sync**: archives don't include bookmarks (detail above); only 5 have been synced.
- **Optional:** `@clawsweeper re-review` on #254 so the verdict covers `cdd4f0e`.
- **After #254 merges:** sync `dev` with upstream, then remove the `birdclaw-archive-media` worktree and branch.
- **Optional cleanup:** delete `~/.birdclaw/birdclaw.demo.sqlite*` and the unzipped archive folder in Downloads.
