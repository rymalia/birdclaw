---
session_id: dfdd5f3e-e063-4890-919b-ba6eb2e41bbf
date: 2026-10-29
time: "2026-10-28 8:31 PM PDT – 2026-10-29 5:17 AM PDT"
resumed: "2026-10-29 3:45 AM PDT"
project: birdclaw
branch: dev
related_pr: 254
---

# Session Summary — wrap-up: live checks, web DM fix, bird 0.9.0 fields, proposals

## Overview

This is the closing summary for session `dfdd5f3e`. The first part (X archive import, the archive-media bug, PR [#254](https://github.com/steipete/birdclaw/pull/254)) is in `session-summary-2026-10-29-x-archive-media-fix.md`. After resuming, this session:
- ran all three live checks against the real database;
- found and fixed a second upstream bug that breaks every web DM read (branch pushed, PR not opened);
- recorded the bird fork's 0.9.0 features;
- confirmed that birdclaw drops bird's new fields;
- wrote the follow-ups up as proposals for tomorrow: `docs/proposals/proposals-2026-10-29-followups.md`.

> Timestamp note: the metadata collector reported `session_start` = `2026-10-29 03:45 AM PDT`, which is the resume time; the hook value was overwritten on resume. The start time above comes from the original SessionStart hook output in this session (`SESSION_START_TIME=2026-10-28 08:31 PM PDT`).

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **Pass `AUTH_TOKEN`/`CT0` inline on each DM command** | The user's `! export` didn't reach later Bash tool calls (each starts a fresh shell); `${AUTH_TOKEN:+set}` came back unset. |
| **Run `sync mentions --latest --limit 5 --max-pages 1` before rerunning mention-threads** | `sync mention-threads` works from locally stored mentions; the archive has none, so the first run did nothing (`mentions: 0`). |
| **Diagnose the 422 by wrapping `fetch`** to log path, status and error body, never headers | It showed which request failed and why without exposing credentials. It pointed at `viewerQuery` with `GRAPHQL_VALIDATION_FAILED` on the variable name. |
| **Read X's live web bundle** to confirm the current `viewerQuery` definition | Confirmed the renamed provided variable (`__relay_internal__pv__xclientsfeaturesappviewerisloggedinrelayprovider`) and that the old name is absent everywhere, instead of guessing. |
| **Discover provided-variable names from the bundle rather than hardcoding the new name** | The bundle that supplies the query id also declares its variables. Reading both keeps them in sync, so the next rename doesn't break DMs again. |
| **Address all Codex pass-1 findings** (cross-operation match, 422 cache reset, missing tests) | P1: the id regex could pair one operation's id with another's name, and now also picks the variables. P2: a long-running `serve` would stay broken after a rename. Each got a test shown to fail without its fix. |
| **Shipped-CLI before/after against the real account** for the PR proof | ClawSweeper's #253 history showed it wants shipped-entry-point proof on pinned SHAs. Output was reduced to status fields with no message content or credentials. |
| **Edit birdclaw `CLAUDE.md`'s local-setup line for bird 0.9.0** | `CLAUDE.md` exists only on `dev` (not in `upstream/main`), so it isn't a local edit to upstream source. The old "0.8.1" text was stale. |
| **Don't change the "lacks" command list** | Checked `bird --help` on 0.9.0: `status`, `dms`, `user`, `profiles`, `list-members`, `block`, `mute` are still absent. |
| **Don't wire bird's new fields in; write proposals instead** | The user asked to pause. Wiring needs decisions: where it goes upstream for `bookmarkedAt`, and a migration for `lang`. |
| **Don't open the DM-fix PR yet** | The user said to pause and review tomorrow. The PR is ready, with its body saved in the repo. |

## Changes Made

| Change | Detail |
|--------|--------|
| **Web DM fix** | `src/lib/x-web.ts`, `src/lib/x-web-dms.test.ts`: commit `f78c167` on `fix/x-web-viewer-provided-variables` (worktree `/Users/rymalia/projects/birdclaw-xweb-viewer`, based on `upstream/main`, tracking unset). **Pushed to `origin` by the user**; PR not opened. |
| **Session summary updates** | `session-summary-2026-10-29-x-archive-media-fix.md`: added the "Live checks and the first bookmark sync, explained" section (`1f20659`), then the smoke test results and the second bug (`80a8a83`). |
| **CLAUDE.md** | Local-setup line now records bird fork 0.9.0 and its new features, and that birdclaw doesn't use them yet (`aafb8ef`). |
| **Proposals** | `docs/proposals/proposals-2026-10-29-followups.md` (new) and `docs/proposals/pr-draft-x-web-viewer-provided-variables.md` (the DM-fix PR body, moved out of the scratchpad; checked to contain no credentials). |
| **Local DB (live reads)** | 5 bookmarks (xurl), 3 mentions (xurl), 1 mention thread merged, 1 DM conversation/message upserted (no new rows; it was already in the archive). |
| **Memory** | `project-pending-x-archive.md`: smoke results, the web DM fix, the `! export` caveat. `git-topology-bird.md`: the fork is now developed past public bird, 0.9.0 details. `MEMORY.md` lines updated for both. |
| **Pushed by the user** | `dev` (now in sync with `origin/dev`) and `fix/x-web-viewer-provided-variables`. |

## Testing / Research Performed

**Live checks** (Node v26.12.1, real `~/.birdclaw` DB):
- `sync bookmarks --mode auto --limit 5 --max-pages 1 --refresh --json`: `ok: true, source: xurl, count: 5`, with a `next_token`.
- `sync mention-threads --limit 1 --max-pages 1`:
  - first run: `ok: true, mentions: 0`;
  - after `sync mentions --latest` (3 mentions, exit 5 = partial): `mentions: 1, succeeded: 1, mergedTweets: 1`.
- `dms sync --mode web --inbox accepted --limit 1 --max-pages 0 --refresh --json`:
  - upstream code: exit 1, `HTTP 422`;
  - with the fix (both the first version and the final `f78c167`): `ok: true, source: web, conversations: 1, messages: 1`.

**Web DM fix verification:**
- `x-web-dms.test.ts`: 30/30. Each new test fails with its fix removed: the neighbouring-operation test with the old regex, the rediscovery test without the 422 reset.
- `bun run check`: clean.
- Full suites on the final code: Node 26.12.1 181/181 files, 1964/1964; Bun 1.4.4 181/181, 1964/1964. An earlier run on the first version: 1963/1963 on both.
- Shipped CLI (`node bin/birdclaw.mjs` after `bun run build`): `main@a08c264` exit 1 with HTTP 422; `f78c167` exit 0 with `ok: true`.
- Codex `gpt-5.6-luna` xhigh, read-only:
  - pass 1: FIX (P1 cross-operation match; P2 no cache reset on 422; P2 missing tests);
  - pass 2: SHIP, no findings.

**Research:**
- Crawled about 80 X web JS modules to find the `viewerQuery` operation (`startup-*.js`, id `Ouqgpqn9ihXpKGhjVeQPoQ`).
- Provenance: the hardcoded variable came in with #209 (`368f569`).
- Bird 0.9.0: read the CHANGELOG and checked the command list with `bird --help`; `~/.local/bin/bird --version` reports `0.9.0 (51d7e9f1)`.
- Traced bird's new fields through birdclaw: `BirdTweetItem` (`bird.ts:46`), `normalizeBirdTweets` (`bird.ts:565`), the collection upsert (`tweet-repository.ts:117`, `collected_at` hardcoded null), the `tweets` schema (no `lang`), and xurl's `tweet.fields` (`xurl.ts:966`, no `lang`).
- DB: `tweet_collections.collected_at` is null for all 5 bookmarks and `1970-01-01T00:00:00.000Z` for all 120,913 archive likes.
- Wrote up the bookmark sync semantics and costs (`docs/sync.md`, `xurl.ts:32` page cap of 90, `~/projects/x-api/docs/x-api-cost-guide.md`).

## Summary Statistics

- Upstream bugs fixed this session: 2 (archive media, #254; web DM viewerQuery, `f78c167`).
- Live checks: 3 of 3 passing on real data (DM only with the fix).
- Codex review passes: 4 total (2 per fix).
- Commits this session: `326efad`, `cdd4f0e` (archive-media branch); `f78c167` (DM branch); `277ab91`, `1f20659`, `80a8a83`, `aafb8ef` on `dev`; plus this summary and the proposals.
- Bird fields traced: 3 (`bookmarkedAt`, `lang`, `isTranslatable`), all dropped.

## Discoveries / Handoff Notes

- **X's web Relay variables get renamed.** `viewerQuery`'s provided variable changed names. The bird fork's 0.9.0 also had to move query-ID discovery to the logged-in `x.com/home` client because X's logged-out pages now serve a different Relay client. Expect more drift like this in anything that scrapes X's web bundle.
- **`! export` in Claude Code doesn't persist** into later Bash tool calls. Pass credentials inline per command, or source a protected env file.
- **Exit code 5 from `sync mentions`** means partial (more pages remain); it isn't an error.
- **Birdclaw records no save or like dates:** live syncs write `collected_at = null`, and archive likes use a 1970 placeholder. Bird's `bookmarkedAt` is the only possible source of bookmark save times.
- **Normalization drops bird extras:** `normalizeBirdTweets` reshapes bird output into xurl's v2 format with a fixed set of fields, so anything xurl doesn't model is lost.
- **Live credentials are in this transcript:** the `auth_token` and `ct0` values appear in this session's transcript. Logging out of x.com in that browser invalidates them.

## Current State

- **`dev`:** in sync with `origin/dev` (the user pushed through `aafb8ef`). This summary and the proposals are committed after that, so `dev` will be ahead again.
- **Worktrees:**
  - `/Users/rymalia/projects/birdclaw-archive-media` (`fix/archive-media-untyped-zip-entries` @ `cdd4f0e`, PR #254);
  - `/Users/rymalia/projects/birdclaw-xweb-viewer` (`fix/x-web-viewer-provided-variables` @ `f78c167`, pushed, no PR). It has a `dist/` build, and `node_modules` is a symlink to the main checkout's.
- **PRs:** #253 and #254 open, ClawSweeper 5/6, waiting for steipete to approve CI.
- **`~/.birdclaw`:** real archive + media, 5 bookmarks, 3 mentions, 1 merged thread tweet.

## Issues & PRs

- https://github.com/steipete/birdclaw/pull/254 — opened this session (archive media)
- https://github.com/steipete/birdclaw/pull/253 — status checked only
- Web DM fix: branch `rymalia:fix/x-web-viewer-provided-variables` pushed; PR to be opened (proposal 1)

## Unfinished Work

These are drafted as proposals for review in `docs/proposals/proposals-2026-10-29-followups.md`:

1. **Open the web DM-fix PR** with the saved body, then add the CHANGELOG commit (another push).
2. **Store `lang`** from xurl and bird (new column plus a migration); upstream-worthy.
3. **Save `bookmarkedAt` into `collected_at`:** decide upstream vs fork-only, and how to route to bird.
4. **`isTranslatable`:** recommend not storing it.
5. **First real bookmark backfill** (about $1.80; best before 2026-11-22); decide whether to wait for proposal 3.
6. **Housekeeping:**
   - optional `@clawsweeper re-review` on #254;
   - sync `dev` and remove the worktrees after merges;
   - delete the demo DB and the unzipped archive;
   - credential hygiene;
   - the latent filename-spaces bug;
   - mentions need a periodic sync.
