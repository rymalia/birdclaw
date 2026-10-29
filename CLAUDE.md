# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Toolchain is **dual-runtime**: source development and CI use an exact **Bun 1.4 canary** (`packageManager: bun@1.4.0-canary.1+f972c287f`, lockfile `bun.lock`, pinned in `toolchains/bun-canary.conf`, see `docs/bun-canary.md`); the published npm/Homebrew CLI is a **Node `>=26.5.1 <27`** program (CI's Node version is in `.node-version`; a local-only `.nvmrc`, excluded via `.git/info/exclude`, pins nvm to 26). There is no pnpm lockfile — don't run `pnpm install`. A newer Bun 1.4.x runs the suite fine locally, but only the exact canary passes `bun run verify:bun` and `pack:smoke`.

Use `bun run <script>` rather than calling vitest/playwright directly. Tests go through `scripts/run-vitest.mjs`, which strips inherited `NODE_OPTIONS` (`scripts/sanitize-node-options.mjs`) and forwards extra args to vitest. Node variants exist for `test`, `coverage`, `e2e`, `build`, `dev`, and `preview` (`<script>:node`).

| Task | Command |
|------|---------|
| Install deps | `bun install --frozen-lockfile` |
| Dev server (port 3000) | `bun run dev` |
| Production build | `bun run build` |
| Typecheck (`tsc --noEmit`) | `bun run typecheck` |
| Format / lint / typecheck (oxfmt + oxlint + tsc) | `bun run check` (or `bun run format`, `bun run lint`) |
| Unit + component tests (vitest, jsdom) | `bun run test` (Node: `bun run test:node`) |
| Coverage with thresholds | `bun run coverage` (Node/V8: `bun run coverage:node`) |
| Single test file | `bun run test src/lib/bird.test.ts` |
| Playwright e2e | `bun run e2e` |
| Browser perf smoke | `bun run perf:browser -- --scenario=links --iterations=5` |
| Run the birdclaw CLI in-tree | `bun run cli <args>` (= `bun --no-env-file src/cli.ts ...`) |
| Build the static docs site | `bun run docs:site` |
| Verify the exact Bun canary | `bun run verify:bun` |

Coverage gate (`vitest.config.ts`): **85% lines/functions/statements; branches 79% under Istanbul (default, Bun) and 80% under V8 (`coverage:node`).** The two providers count branches differently — don't "fix" the gap by lowering V8. Ordinary tests have a 10s timeout, coverage runs 30s.

CI (`.github/workflows/ci.yml`) installs the exact Bun canary and runs check, coverage, build, and e2e with `BIRDCLAW_DISABLE_LIVE_WRITES=1`.

## Storage and config

Default storage root is `~/.birdclaw/` (override with `BIRDCLAW_HOME`). `getBirdclawPaths()` in `src/lib/config.ts` resolves the root, `birdclaw.sqlite`, `media/originals`, `media/thumbs`, and `config.json` — go through it, don't hardcode. Job modules (`account-sync-job.ts`, `bookmark-sync-job.ts`) derive their own `audit/`, lock, and `logs/` paths under that root.

The config file is `BIRDCLAW_CONFIG` if set, else `<root>/config.json`. Three knobs route live X traffic, each resolved env → config file → default:

- `mentions.dataSource` (`birdclaw` | `auto` | `xurl` | `bird`) — mentions **read** routing, via `resolveMentionsDataSource()` (env `BIRDCLAW_MENTIONS_DATA_SOURCE`)
- `actions.transport` (`auto` | `bird` | `xurl`) — moderation **write** routing, via `resolveActionsTransport()` (env `BIRDCLAW_ACTIONS_TRANSPORT`; CLI `auth use`)
- `transport.preferred` (`bird` | `xurl`, unset by default) — global preference that moves its transport to the front of every two-transport `auto` chain, via `getPreferredTransport()` (env `BIRDCLAW_PREFERRED_TRANSPORT`; CLI `auth prefer <bird|xurl|auto>`, `auto` clears it)

An explicit `--mode` beats env, which beats config. With no preference, **the default `auto` order is per-chain — read the chain before assuming**. Examples: bookmarks/likes (`timeline-collections-live.ts`) and mention threads go xurl → bird; Lists, follow graph, and moderation go bird → xurl via `getAutoTransportOrder("bird")`; tweet search with no preference runs *both* bird and xurl and merges results (`tweet-search-live.ts`). Two helpers apply the preference: `getAutoTransportOrder()` at chain construction, and `fetchWithTransportFallbackEffect` in `live-sync-engine.ts`, which re-sorts adapter lists at fetch time. Don't add another routing knob — extend these, and build new `auto` chains on one of those helpers so the preference applies.

## X/Twitter transport architecture (the load-bearing piece)

birdclaw never imports an X SDK. Live access goes through adapters in `src/lib/`; the tweet-shaped ones produce the **same normalized shape** so downstream code is transport-blind:

1. **`xurl.ts`** — shells out to the user's `xurl` CLI (resolved as `xurl` on `PATH`), which speaks the **official X v2 API** (OAuth2/Bearer). Default primary for the xurl-first chains above: likes, bookmarks (paginated bookmark walks cap the per-page `max_results` at 90), mention-thread conversation search + parent-chain ancestor lookup. `research` works from local bookmarks and only goes live (via `tweet-lookup.ts`) to fetch missing ancestors. Also performs moderation writes, validated from the mutation response. Handles 429 with exponential backoff; caches `xurl auth status` and `whoami` in-process.
2. **`bird.ts`** — shells out to bird (cookie-auth **undocumented web GraphQL API**). Optional compatibility path (primary in the bird-first chains above, fallback elsewhere). Resolves the binary via `getBirdCommand()`: `BIRDCLAW_BIRD_COMMAND` env → `mentions.birdCommand` config → `bird` on `PATH` → literal `bird`. Captures large JSON output via a bash redirection into a temp file (the buffer-cap trick — see `readBirdStdoutEffect` / `runBirdJsonCommandEffect`). `normalizeBirdTweets()` re-shapes bird's `{id,text,author,…}` into xurl's `{data, includes, meta}`.
   - **Local setup (this machine, not in source):** `~/.birdclaw/config.json` `mentions.birdCommand` points at `~/.local/bin/bird`, a launcher that runs the sibling fork `/Users/rymalia/projects/bird` (`dist/cli.js`, 0.9.0 as of 2026-10-29) under nvm's default Node. The fork now goes beyond public `@steipete/bird` (0.8.x): 0.9.0 adds `bookmarkedAt` on bookmarks, `lang`/`isTranslatable` on every tweet, a machine-readable `read --json` failure contract (`{"error": {"kind", "reason", "status", "message"}}`), and working query-ID discovery via the logged-in `x.com/home` client with an enforced 24h cache TTL (see the fork's `CHANGELOG.md`). birdclaw doesn't consume those fields yet — `normalizeBirdTweets()` is unchecked for them, and bookmark/like `auto` chains reach bird only as the fallback after xurl. The fork still **lacks** `status`, `dms`, `dm-accept`/`dm-reject`/`dm-block`, `user`, `profiles`, `list-members`, and `block`/`unblock`/`mute`/`unmute`; birdclaw calls those against steipete's private bird. With this fork, those operations only work via xurl or x-web; explicit `--mode bird` for them fails.
3. **`x-web.ts` + `x-web-dms.ts`** — native web path: direct `fetch` against x.com with the public web bearer token and **`AUTH_TOKEN` / `CT0` environment variables** (no browser-cookie extraction). Plain async, not Effect. Used for **DM reads and message-request accept/reject/block** (`dms ... --mode web`; `auto` DM sync can reach it on a cache miss when the env credentials are present, depending on inbox and fallback state — see `dms-live.ts`). Not part of moderation routing.
4. **`fxtwitter.ts`** — opt-in (`--fxtwitter`) read-only imports of named public tweets, threads, conversations, profiles, and bounded search from FxTwitter. Records source/completeness observations; thread/conversation imports are always marked partial (no exhaustion proof). Not a bookmark or bulk-archive transport.

**Moderation orchestration** lives in `src/lib/actions-transport.ts` → `runModerationAction`. In `auto` mode it walks `getAutoTransportOrder("bird")` — bird first (bird mutations are verified via `bird status`), then xurl (account check via `verifyXurlAccount`, success judged from the mutation response; no `bird status` call). There is no x-web leg. Prior failure messages are preserved in the output so the caller sees the full chain.

`BIRDCLAW_DISABLE_LIVE_WRITES=1` short-circuits every live mutation. It is set automatically by `src/test/setup.ts`, the Playwright web server, and CI. When adding new write paths, gate them on this flag.

## Cache-first sync (do not break this)

Most read-side syncs store normalized results in SQLite (`sync_cache`, `tweet_collections`, `tweet_account_edges`, `follow_edges`/`follow_snapshots`, etc.) and serve repeat calls from a freshness-checked cache; `--refresh` forces a live hit on the commands that support it. `sync followers`/`sync following` default to dry-run and require `--yes` to spend a live read. Ordinary bookmark sync fetches one page unless `--all`, `--max-pages`, or `--early-stop` is given. Several live paths sit outside the freshness-cache contract, including authored-tweet sync (cursor state only), `sync mentions --latest`/`--resume`, `sync mention-threads`, Lists, profile hydration, explicit `--fxtwitter` imports, and `research` ancestor lookups — check a command's code before assuming a repeat call is free. When adding a new live-fetch path, follow the cache shape anyway: cache key → check freshness → fetch only if missing/expired/`--refresh`. Skipping this is how an agent loop burns through an account's X API budget.

## Data model

Single SQLite DB through a custom synchronous wrapper around `node:sqlite` (`src/lib/sqlite.ts`, better-sqlite3-shaped API) — **no Kysely/ORM**. Schema and migrations live in `src/lib/database-schema.ts` / `database-migrations.ts`; the connection is opened in `src/lib/db.ts`. Shared domain types are in `src/lib/types.ts`; SQL row types are mostly declared next to the queries that use them. Under Bun, read connections open normally and set `pragma query_only = on` (WAL coordination needs it); under Node they open natively read-only. Conventions worth knowing:

- **Tweets are canonical-by-id**, account-shared. Per-account membership lives in **edge tables** (`tweet_collections` for likes/bookmarks, `tweet_account_edges` for `home`/`mention`/`authored`/`search`/`profile`/`thread_context`). Don't add account-id columns to `tweets` — write an edge instead, or a shared tweet seen by multiple accounts will get clobbered.
- **Identity is layered.** Live profile metadata writes to `profiles` (canonical), `profile_snapshots` (history), `profile_affiliations` (badge edges), `profile_bio_entities` (extracted `@handles`/domains/companies), and a derived `identity_search_index`. The `whois` ranker in `src/lib/whois.ts` reads all five — adding identity evidence usually means adding a new `kind` to bio entities + index, not a new table.
- **FTS5** drives `tweets_fts` and `dm_fts`. Sanitize user input (see `406b7bf fix: sanitize fts search queries`).
- Follow events and sync-job audit logs are **append-only**: insert a new row, don't `UPDATE`. DM storage is *not* — DM sync upserts `dm_messages` by id and deletes preview placeholders it supersedes.

## CLI + web app share `src/lib/`

There is **no `packages/*` workspace** despite what `docs/data-architecture.md` describes — everything is flat under `src/`. Two entry points consume the same lib code:

- **CLI**: `src/cli.ts` builds the Commander program from `src/cli/register-*.ts` modules (moderation via `src/cli/register-moderation.ts` → `src/cli-moderation.ts`). In development run it with `bun run cli ...`; the packaged `bin/birdclaw.mjs` imports the built `dist/cli/birdclaw.js`.
- **Web app**: TanStack Start, file-routed under `src/routes/`. Server functions live in `src/routes/api/*.tsx`; `src/router.tsx` wires it up. `routeTree.gen.ts` is generated — don't hand-edit. `serve` also hosts the read-only MCP endpoint (`/mcp`, disabled unless `BIRDCLAW_MCP_TOKEN` and `BIRDCLAW_MCP_PUBLIC_URL` are set; see `docs/mcp.md`).

When adding a feature, the pattern is: put logic in `src/lib/<feature>.ts` with a unit test, expose it via both a Commander subcommand and (if user-facing) an `src/routes/api/<feature>.tsx` server function. Keep the route file thin.

## Testing notes

- `src/test/setup.ts` sets `BIRDCLAW_DISABLE_LIVE_WRITES=1`, installs in-memory `localStorage`/`sessionStorage`, and pulls in `@testing-library/jest-dom`. Tests should not touch the user's real `~/.birdclaw` — point at a temp dir via `BIRDCLAW_HOME`.
- Vitest runs under both runtimes; run `test` (Bun) and `test:node` when touching runtime-sensitive code (SQLite, subprocesses, DOM). jsdom is pinned (30.0.1) because newer combinations break DOM workers under the Bun canary.
- `src/components/timeline-rendering.test.tsx` (500-card case) runs ~4.5s in isolation and can hit the 10s ceiling under a full parallel Node run — a load flake, not a regression; rerun the file alone to confirm.
- Playwright runs against `.playwright-home/` with live writes disabled and a configurable port (`BIRDCLAW_PLAYWRIGHT_PORT`, default 3000).
- Tests run through `scripts/run-vitest.mjs` so that inherited `NODE_OPTIONS` like `--localstorage-file` from sibling repos don't leak in. Don't call `vitest` directly in repo scripts for the same reason.

## Other conventions

- ESM only (`"type": "module"`), import alias `#/` → `./src/`.
- oxlint config is in `package.json` (`scripts.lint`) and turns on import/node/vitest plugins with `--deny-warnings`. New code should not introduce warnings; if you need a suppression, prefer the line-level form over widening the global ignore list.
- oxfmt is the formatter (tabs, double quotes, `.oxfmtrc.json`). Run `bun run format` before committing.
- `docs/data-architecture.md` and `docs/spec.md` describe intent (some of which is aspirational — e.g. the packages layout). When the docs disagree with the code, the code wins; consider whether the doc should be updated.
