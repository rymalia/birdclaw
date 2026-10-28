---
session_id: 823ca0ed-d8fb-4afb-8ed2-6d06ad8c7e33
date: 2026-10-27
time: "3:07 PM PDT – 5:10 PM PDT"
project: birdclaw
branch: dev
---

# Session Summary — birdclaw v0.16.3 environment repair: Node 26, bird launcher, xurl, CLAUDE.md resync

## Overview

Repaired the local birdclaw environment after the v0.6 → v0.16.3 catch-up. The work replaced the dead Node-pinned bird path with a stable launcher, made Node 26 the nvm default, set a test baseline, reinstalled and re-authenticated xurl, and rewrote the project CLAUDE.md, which had gone stale. Eight read-only Codex luna review passes informed the work. Live smoke testing stopped partway because `~/.birdclaw` turned out to hold the demo seed archive, not the user's data. The user has requested their X archive.

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **Shell launcher at `~/.local/bin/bird` instead of the compiled `~/projects/bird/bird` binary** | The Mach-O binary is a stale 0.8.0 build. The launcher runs the fork checkout's `dist/cli.js` (0.8.1, `4afcd6f`), so `pnpm build:dist` rebuilds take effect automatically. It resolves Node at run time, so it survives nvm upgrades. |
| **Launcher resolves nvm `default` (via `nvm.sh --no-use`), falls back to the newest installed nvm Node, and requires major ≥ 22** | launchd provides a minimal PATH, so `#!/usr/bin/env node` is unreliable there. The ≥ 22 check matches bird's `engines.node`; Codex pass 1 flagged it as missing. Reading the major version from the nvm path avoids starting Node a second time. A system Node (outside nvm) is deliberately rejected. |
| **`nvm alias default 26.12.1` (global)** | The user asked to switch to Node 26. It was also necessary because the old `npm link` for bird existed only under v24.22.1. This change affects every project and new shell. |
| **`bun install --frozen-lockfile`, not `pnpm install`** | The repo now uses `packageManager: bun@1.4.0-canary.1+f972c287f` and has only `bun.lock`. The handoff's `pnpm install` would have created a stray lockfile. |
| **Kept Bun 1.4.4 rather than installing the exact canary** | The pin is enforced only by `scripts/verify-bun-canary.mjs` and `package-smoke.mjs`. Install, typecheck and tests all ran under 1.4.4. |
| **CLAUDE.md rewritten and committed to `dev`** | The file exists only on the fork (not in `upstream/main`), so editing it causes no merge conflicts. |
| **Did not fix the flaky timeline test** | It is upstream code. Codex judged it FLAKY-LOAD. The honest fix is a per-test timeout of 15–20s, which belongs in an upstream PR (option c, declined this session). |
| **Rejected half of Codex fact-check finding #1** | It said `transport.preferred` doesn't reorder hardcoded xurl→bird chains. But `fetchWithTransportFallbackEffect` in `src/lib/live-sync-engine.ts:203-210` re-sorts adapters by preference. The valid part (the default first transport varies by chain) was kept. |
| **Wrote an example-based routing rule instead of an exhaustive chain list** | Codex pass 8 found the chain list incomplete (home, authored, mentions, profiles, DMs). An exhaustive list would go stale, so the doc gives the rule, examples, and an instruction to read the chain's code. |
| **Stopped live syncing once the demo database was found** | `docs/quickstart.md:64` says not to live-sync an empty or demo database. The bookmarks guard also refused. |

## Changes Made

| Change | Detail |
|--------|--------|
| **bird launcher** | Created `~/.local/bin/bird` (POSIX sh, executable). Second revision added `MIN_NODE_MAJOR=22`, `node_major()` and `usable()`. Outside any repo. |
| **birdclaw config** | `~/.birdclaw/config.json` `mentions.birdCommand`: `/Users/rymalia/.nvm/versions/node/v24.12.0/bin/bird` → `/Users/rymalia/.local/bin/bird`. Backup at `~/.birdclaw/config.json.bak-2026-10-27`. `actions.transport: auto` unchanged. |
| **nvm default** | `nvm alias default 26.12.1` (was 24.22.1). |
| **Dependencies** | `bun install --frozen-lockfile` installed 386 packages. |
| **xurl** | `brew install --cask xdevplatform/tap/xurl` installed 1.3.4 at `/opt/homebrew/bin/xurl`. It migrated the old `~/.xurl` into `~/.xurl/auth.yml` (app `go-getter`). The user then re-authenticated with `xurl auth oauth2 --app go-getter`. |
| **CLAUDE.md** | Commit `29f64bc` on `dev` (`docs(claude): resync CLAUDE.md with v0.16.3 toolchain and transports`), 44 insertions and 35 deletions. Not pushed. |
| **Memory** | Added `project-pending-x-archive.md` plus a `MEMORY.md` index line: the database is the demo seed, so no live syncs until the archive is imported. |
| **Live data (incidental)** | `sync mention-threads` merged 1 live tweet into the demo database before the demo status was discovered. Nothing was written to X. |

## Testing / Research Performed

**Baseline (Node v26.12.1, Bun 1.4.4)**
- `bun --no-env-file run typecheck` (`tsc --noEmit`): exit 0.
- `bun run test`: 181/181 files, **1962/1962 tests passed** (184.37s).
- `node ./scripts/run-vitest.mjs run` (test:node): **1961/1962**. The one failure is `src/components/timeline-rendering.test.tsx` "keeps 500 unchanged cards…", which timed out at 10000ms under the full parallel run. Running the file alone twice gave 2/2 passing (4.79s and 4.54s).
- `bun run test src/lib/bird.test.ts`: 35/35. This confirmed the single-file command used in the new CLAUDE.md.

**Launcher**
- `env -i HOME=$HOME PATH=/usr/bin:/bin ~/.local/bin/bird --version` → `0.8.1 (4afcd6f0)`, exit 0. Ran before and after the Node check was added.
- A fake `NVM_DIR` containing only `v20.1.0` → `bird launcher: no nvm node >= 22 found…`, exit 127.
- birdclaw's `getBirdCommand()` resolves to `/Users/rymalia/.local/bin/bird`.
- `bird status jack --json` → `unknown command 'status'`, and `bird dms --json` → `unknown command 'dms'`. These confirm the fork's command gaps. (`--help` exit codes were unreliable: commander exits 0 for unknown commands.)

**xurl / auth**
- Before re-auth, `xurl whoami` → 403 "Unsupported Authentication" (it used the app-only bearer). `xurl --auth oauth2 whoami` → `RefreshTokenError … token was invalid`.
- After the user re-authenticated, `xurl --auth oauth2 whoami` → `ryanmalia`, id `16281489`.
- `birdclaw auth status` → `availableTransport: "xurl"`. This reported success even while the token was expired, so it doesn't validate tokens.

**Live smoke tests**
- `sync mention-threads --mode auto --limit 1 --max-pages 1 --json` → `ok: true, source: xurl, threads: 1, succeeded: 1, mergedTweets: 1, partial: false`. It ran against the demo database.
- `sync bookmarks --mode auto --limit 5 --max-pages 1 --refresh --json` → exit 1, `bird is authenticated as user 16281489; refusing to sync into acct_primary (25401953)`.
- DM read via x-web: **not run**, because `AUTH_TOKEN`/`CT0` were not set in the session environment.

**Codex luna review passes (all `-s read-only`, `--disable plugins`)**

| # | Model / effort | Scope | Verdict |
|---|---|---|---|
| 1 | gpt-5.6-luna xhigh | Launcher robustness | FIX: missing Node ≥ 22 check (applied) |
| 2 | gpt-6-luna high | birdclaw ↔ bird integration and command matrix | ISSUES: fork lacks many commands (verified) |
| 3 | gpt-5.6-luna high | Flaky timeline test | FLAKY-LOAD |
| 4 | gpt-5.6-luna xhigh | CLAUDE.md audit | 16 stale claims |
| 5 | gpt-6-luna high | xurl and smoke-test runbook | RUNBOOK READY |
| 6 | gpt-5.6-luna xhigh | Fact-check of the CLAUDE.md rewrite | 12 corrections (11 applied, #1 partly rejected) |
| 7 | gpt-6-luna high | Launcher re-review | SHIP, no findings |
| 8 | gpt-5.6-luna xhigh | Second pass on the corrections | 3 corrections (applied) |

I re-checked key Codex claims directly in source:
- bird commands, by calling them;
- `kysely` count in `package.json` = 0;
- `getBirdCommand` order (`config.ts:251-267`);
- `getAutoTransportOrder("bird")` callers;
- the `live-sync-engine.ts` re-sort;
- tweet search running both transports and merging (`tweet-search-live.ts:410-448`);
- the six `TweetAccountEdgeKind` values;
- `runBirdJsonCommandEffect`;
- `BIRDCLAW_CONFIG`;
- `dm_messages` upsert and delete.

Codex reports and prompts are in `/private/tmp/claude-501/-Users-rymalia-projects-birdclaw/823ca0ed-d8fb-4afb-8ed2-6d06ad8c7e33/scratchpad/codex/` (`p1–p8.txt`, `r1–r8.md`). This is session scratch space and may not persist.

## Summary Statistics

- Repo commits: 1 (`29f64bc`, CLAUDE.md only); repo source files changed: 0
- Files changed outside the repo: 2 (`~/.local/bin/bird` created, `~/.birdclaw/config.json` repointed) plus 1 backup
- Global environment changes: 2 (nvm default → 26.12.1, xurl 1.3.4 installed)
- Test runs: 2 full suites (Bun 1962/1962, Node 1961/1962), plus 2 isolated reruns and 1 single-file run
- Codex luna passes: 8
- CLAUDE.md stale claims corrected: 16 from the audit, plus 12 and 3 from the follow-up passes
- Live smoke tests: 1 passed, 1 refused by the guard, 1 not run

## Discoveries / Handoff Notes

- **`~/.birdclaw/birdclaw.sqlite` is the `init --demo` seed.** It has accounts `acct_primary` "Peter @steipete" (ext id 25401953, the default) and `acct_studio` "Studio @birdclaw_lab", 15 tweets, created `2026-03-08T12:00`. Live syncs check that the authenticated user matches `acct_primary` and refuse when it doesn't. Open it read-only with `sqlite3 "file:$HOME/.birdclaw/birdclaw.sqlite?immutable=1"`, because plain `-readonly` fails under WAL.
- **The bird fork (0.8.1) lacks** `status`, `dms`, `dm-accept`/`dm-reject`/`dm-block`, `user`, `profiles`, `list-members`, and `block`/`unblock`/`mute`/`unmute`. birdclaw calls these against steipete's private bird.
  - Moderation in auto mode tries bird first, fails, and falls back to xurl.
  - Explicit `--mode bird` for those operations fails outright.
  - Reads work: bookmarks, mentions, likes, search, read, thread, home, followers/following, lists.
- **Default auto transport order varies by chain:**
  - xurl first: bookmarks, likes, mention threads.
  - bird first: Lists, follow graph, moderation.
  - Tweet search with no preference runs both, one after the other, and merges.
  - `transport.preferred` (`auth prefer`) reorders all of them through `getAutoTransportOrder()` or the `live-sync-engine` re-sort.
- **xurl auth:** birdclaw passes `--auth oauth2` explicitly (`xurl.ts:506`). The OAuth2 refresh token had expired from disuse, and `birdclaw auth status` doesn't detect that. Use `xurl --auth oauth2 whoami` for a real check.
- **x-web DMs** need `AUTH_TOKEN`/`CT0` in the environment. There is no browser-cookie extraction.
- **CLAUDE.md is fork-only** (`77104c9`, not in `upstream/main`), so it's safe to keep editing on `dev`.
- **`.nvmrc` (26.12.1) is local-only**, excluded via `.git/info/exclude`. `.node-version` (26.10.0) is the tracked CI value.
- Commander exits 0 on `bird <unknown> --help`, so probe with real invocations, not help exit codes.

## Current State

- Branch `dev`, 1 commit (`29f64bc`) ahead of the state at session start, not pushed. Push with `git push origin dev`.
- This summary file is new and uncommitted under `docs/session-summaries/`.
- nvm default is Node v26.12.1. The bird launcher works under a launchd-like environment.
- xurl 1.3.4 is authenticated as @ryanmalia (OAuth2, app `go-getter`).
- The database is still the demo seed, with 1 live mention-thread tweet merged in.
- The user requested their X archive on 2026-10-27; X may take a few days.

### Unfinished Work

1. **When the X archive arrives:**
   - `mv ~/.birdclaw/birdclaw.sqlite ~/.birdclaw/birdclaw.demo.sqlite`
   - `bun run cli import archive <zip>`
2. **Rerun the smoke tests against the real archive:**
   - `sync bookmarks --mode auto --limit 5 --max-pages 1 --refresh --json`
   - `sync mention-threads --mode auto --limit 1 --max-pages 1 --json`
   - the x-web DM read: `dms sync --mode web --inbox accepted --limit 1 --max-pages 0 --refresh --json`, with `AUTH_TOKEN`/`CT0` exported. Avoid `dms accept/reject/block`, which write to X.
3. **Optional:** read-only MCP. Set `BIRDCLAW_MCP_TOKEN` (≥ 32 bytes) and `BIRDCLAW_MCP_PUBLIC_URL=http://127.0.0.1:3000/mcp`, then `bun run cli serve`. Also try `auth prefer` routing.
4. **Optional upstream PR (option c, not done):** a per-test timeout (15–20s) for the 500-card case in `src/components/timeline-rendering.test.tsx`.
5. **Push** `29f64bc`, and commit this summary if wanted.
6. If xurl auth fails again after a long idle gap, rerun `xurl auth oauth2 --app go-getter`.
