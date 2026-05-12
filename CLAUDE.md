# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager: **pnpm 10** on **Node >=25.8.1 <27**. Scripts go through a wrapper that strips inherited `NODE_OPTIONS` (see `scripts/run-vitest.mjs`, `scripts/sanitize-node-options.mjs`) — invoke them via `pnpm` rather than running vitest/playwright directly.

| Task | Command |
|------|---------|
| Dev server (port 3000) | `pnpm dev` |
| Production build | `pnpm build` |
| Typecheck (uses `tsgo` from `@typescript/native-preview`, **not** `tsc`) | `pnpm typecheck` |
| Format / lint (oxfmt + oxlint) | `pnpm check` (or `pnpm format`, `pnpm lint`) |
| Unit + component tests (vitest, jsdom) | `pnpm test` |
| Coverage with thresholds | `pnpm coverage` |
| Single test file | `pnpm exec vitest run src/lib/bird.test.ts` |
| Playwright e2e | `pnpm e2e` |
| Browser perf smoke | `pnpm perf:browser -- --scenario=links --iterations=5` |
| Run the birdclaw CLI in-tree | `pnpm cli <args>` (= `tsx src/cli.ts ...`) |
| Build the static docs site | `pnpm docs:site` |

Coverage gate (`vitest.config.ts`): **85% lines/functions/statements, 82% branches.**

CI (`.github/workflows/ci.yml`) runs `pnpm check`, `pnpm coverage`, `pnpm build`, and `pnpm e2e` with `BIRDCLAW_DISABLE_LIVE_WRITES=1`.

## Storage and config

Default storage root is `~/.birdclaw/` (override with `BIRDCLAW_HOME`). Key paths: `birdclaw.sqlite`, `media/originals`, `media/thumbs`, `config.json`, `audit/`, `logs/`. `getBirdclawPaths()` in `src/lib/config.ts` is the only place that resolves these — go through it, don't hardcode.

Two **independent** config knobs route live X traffic:

- `mentions.dataSource` (`birdclaw` | `xurl` | `bird`) — **read** routing, via `resolveMentionsDataSource()`
- `actions.transport` (`auto` | `bird` | `xurl`) — **write** routing for block/mute, via `resolveActionsTransport()`

Both fall back through env (`BIRDCLAW_MENTIONS_DATA_SOURCE`, `BIRDCLAW_ACTIONS_TRANSPORT`) then `~/.birdclaw/config.json`. Don't introduce a third "transport" knob — extend these.

## X/Twitter transport architecture (the load-bearing piece)

birdclaw never imports an X SDK. All live access is one of three adapters in `src/lib/`, each producing the **same normalized shape** so downstream code is transport-blind:

1. **`xurl.ts`** — shells out to the user's `xurl` CLI, which speaks the **official X v2 API** (OAuth2/Bearer). Used for paged mention/likes/bookmark reads and for block/mute writes. Handles 429 with exponential backoff; caches `xurl auth status` and `whoami` in-process.
2. **`bird.ts`** — shells out to `@steipete/bird` (the sibling repo at `/Users/rymalia/projects/bird`) for the **undocumented web GraphQL API via cookie auth**. Resolves the bird binary via `getBirdCommand()`: `BIRDCLAW_BIRD_COMMAND` env → `mentions.birdCommand` config → `PATH` → `~/Projects/bird/bird`. Captures large JSON output by running bird with a bash redirection into a temp file (the buffer-cap trick — see `runBirdJsonCommand`). `normalizeBirdTweets()` re-shapes bird's `{id,text,author,…}` into xurl's `{data, includes, meta}` so consumers don't branch on transport.
3. **`x-web.ts`** — last-resort fallback: direct `fetch` against `https://x.com/i/api/1.1/...` using the **public web bearer token + `auth_token`/`ct0` cookies** read from Safari/Chrome/Firefox via `@steipete/sweet-cookie`. Only implements block/unblock (X rejects pure-OAuth2 block writes).

**Write orchestration** lives in `src/lib/actions-transport.ts` → `runModerationAction`. In `auto` mode: try bird → try xurl (then verify the resulting state via `bird status` before counting it as success) → fall back to x-web for block/unblock only. Always preserves prior failure messages in the output so the caller sees the full chain.

`BIRDCLAW_DISABLE_LIVE_WRITES=1` short-circuits every live mutation. It is set automatically by `src/test/setup.ts` and the Playwright web server, and in CI. When adding new write paths, gate them on this flag.

## Cache-first sync (do not break this)

Every read-side sync command stores normalized results in SQLite (`sync_cache`, `tweet_collections`, `tweet_account_edges`, `follow_edges`/`follow_snapshots`, etc.) and serves repeat calls from there. `--refresh` is the only flag that re-hits X. `sync followers`/`sync following` additionally default to dry-run and require `--yes` to spend a live read. When adding a new live-fetch path, follow the same shape: cache key → check freshness → fetch only if missing/expired/`--refresh`. Skipping this is how an agent loop burns through an account's X API budget.

## Data model

Single SQLite DB via Kysely + a thin `node:sqlite` wrapper (`src/lib/sqlite.ts`) that re-exports a better-sqlite3-shaped synchronous API. All table types live in `src/lib/db.ts`. Conventions worth knowing:

- **Tweets are canonical-by-id**, account-shared. Per-account membership lives in **edge tables** (`tweet_collections` for likes/bookmarks, `tweet_account_edges` for home/mention). Don't add account-id columns to `tweets` — write an edge instead, or a shared tweet seen by multiple accounts will get clobbered.
- **Identity is layered.** Live profile metadata writes to `profiles` (canonical), `profile_snapshots` (history), `profile_affiliations` (badge edges), `profile_bio_entities` (extracted `@handles`/domains/companies), and a derived `identity_search_index`. The `whois` ranker in `src/lib/whois.ts` reads all five — adding identity evidence usually means adding a new `kind` to bio entities + index, not a new table.
- **FTS5** drives `tweets_fts` and `dm_fts`. Sanitize user input (see `406b7bf fix: sanitize fts search queries`).
- DM events, follow events, and bookmark-sync runs are **append-only audit logs**. Don't `UPDATE` them; insert a new row.

## CLI + web app share `src/lib/`

There is **no `packages/*` workspace** despite what `docs/data-architecture.md` describes — everything is flat under `src/`. Two entry points consume the same lib code:

- **CLI**: `bin/birdclaw.mjs` → `tsx src/cli.ts` → Commander program. Moderation subcommands are registered separately in `src/cli-moderation.ts`. Use `pnpm cli ...` during development.
- **Web app**: TanStack Start, file-routed under `src/routes/`. Server functions live in `src/routes/api/*.tsx`; `src/router.tsx` wires it up. `routeTree.gen.ts` is generated — don't hand-edit.

When adding a feature, the pattern is: put logic in `src/lib/<feature>.ts` with a unit test, expose it via both a Commander subcommand and (if user-facing) an `src/routes/api/<feature>.tsx` server function. Keep the route file thin.

## Testing notes

- `src/test/setup.ts` sets `BIRDCLAW_DISABLE_LIVE_WRITES=1`, installs in-memory `localStorage`/`sessionStorage`, and pulls in `@testing-library/jest-dom`. Tests should not touch the user's real `~/.birdclaw` — point at a temp dir via `BIRDCLAW_HOME`.
- Playwright runs against `.playwright-home/` with live writes disabled and a configurable port (`BIRDCLAW_PLAYWRIGHT_PORT`, default 3000).
- `pnpm test` runs through `scripts/run-vitest.mjs` so that inherited `NODE_OPTIONS` like `--localstorage-file` from sibling repos don't leak in. Don't call `vitest` directly in repo scripts for the same reason.

## Other conventions

- ESM only (`"type": "module"`), import alias `#/` → `./src/`.
- oxlint config is in `package.json` (`scripts.lint`) and turns on import/node/vitest plugins with `--deny-warnings`. New code should not introduce warnings; if you need a suppression, prefer the line-level form over widening the global ignore list.
- oxfmt is the formatter (tabs, double quotes, `.oxfmtrc.json`). Run `pnpm format` before committing.
- `docs/data-architecture.md` and `docs/spec.md` describe intent (some of which is aspirational — e.g. the packages layout). When the docs disagree with the code, the code wins; consider whether the doc should be updated.
