---
title: bird (rymalia fork) vs birdclaw — comparison and decision reference
created: 2026-05-11
type: reference
status: snapshot
projects: [bird, birdclaw]
versions_captured:
  bird_fork:
    version: "0.8.1"
    head: 4afcd6f
    head_date: 2026-02-24
    location: /Users/rymalia/projects/bird
    remote: https://github.com/rymalia/bird.git
  bird_published_npm:
    latest_version: "0.8.0"
    all_versions: ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.4.1", "0.5.1", "0.6.0", "0.7.0", "0.8.0"]
    status: frozen
    verified_on: 2026-05-11
    verified_via: "npm view @steipete/bird version / versions"
    note: >-
      The newer bird subcommands birdclaw calls (dms, profiles, user --profile-only,
      status, block, unblock, mute, unmute) exist in NO public bird release. They
      appear to live only in steipete's private development environment and have
      never shipped publicly. birdclaw routes those calls through xurl or the
      x-web cookie fallback in practice; the bird-transport paths for those
      surfaces are partially aspirational on every public user's machine.
  birdclaw:
    version: "0.4.1"
    branch: main
    location: /Users/rymalia/projects/birdclaw
    repo: https://github.com/steipete/birdclaw
tags: [twitter, x-api, transport, decision-guide, adapter-pattern, archive, sqlite]
---

# bird (rymalia fork) vs birdclaw — comparison and decision reference

> **Snapshot.** Versions captured above. As of `verified_on`, public `@steipete/bird` is frozen at 0.8.0 — it is **not** a moving target the way most actively maintained packages are. Re-check `npm view @steipete/bird versions` if this doc is more than a few months old, since the situation could change if steipete ever resumes public releases.

## TL;DR — three corrections to a common framing

The natural read on these two repos is *"steipete closed bird and replaced it with birdclaw, which quietly bundles bird inside."* That's wrong in three specific ways:

1. **birdclaw does not contain bird.** It contains a ~640-line **subprocess adapter** (`src/lib/bird.ts`) that `execFile`s a `bird` binary the user must install separately. No `TwitterClient`, no GraphQL client, no `query-ids.json`, no cookie reader — none of bird's internals were copied in. LOC scale:

   | Bird-as-library (rymalia/bird @ 0.8.1) | Bird-as-adapter (in birdclaw) |
   |---|---|
   | `src/lib/twitter-client*.ts` — 6,331 LOC | `src/lib/bird.ts` + `bird-actions.ts` — 858 LOC |
   | 30+ TwitterClient mixin files, GraphQL query-ID rotation, sweet-cookie integration, REST fallback for tweet/follow | `runBirdCommand(args)` → `JSON.parse(stdout)`, that's it |

2. **birdclaw is a strictly higher-level product**, not a successor to bird. They live at different layers:

   | | bird (fork @ 0.8.1) | birdclaw |
   |---|---|---|
   | **Layer** | Transport library + CLI | Local-first workspace |
   | **Primary store** | Stateless — every call hits X | SQLite (`~/.birdclaw/birdclaw.sqlite`) as canonical truth |
   | **Search** | None | FTS5 over tweets + DMs |
   | **UI** | CLI only | TanStack Start web app (Home / Mentions / DMs / Likes / Bookmarks / Inbox / Links / Blocks) |
   | **Identity** | None | `profiles` + `profile_snapshots` + `profile_affiliations` + `profile_bio_entities` + derived `identity_search_index`, plus `whois` ranker |
   | **Follow graph** | List `following`/`followers` | Edge tables + snapshots + append-only churn events + mutuals/unfollow queries |
   | **AI** | None | OpenAI inbox scoring, ranked inbox with low-signal filter |
   | **Archive** | None | Twitter archive autodiscovery + import (tweets/likes/bookmarks/DMs/follows) |
   | **Persistence** | None | Git-friendly JSONL backup (export / import / sync / validate), launchd scheduled bookmark sync |
   | **Transports** | Single: cookie GraphQL | Three: `xurl` (official v2 API) + `bird` (cookie GraphQL via the bird CLI) + `x-web` (direct cookie fetch fallback) |

3. **"Better and more featured" is true at the system level, but comparing the two directly is apples-to-oranges**: bird is one of three replaceable adapters inside birdclaw. The thing that's strictly *new* in birdclaw — local SQLite, FTS, UI, AI, identity, backup — has nothing to do with bird.

## Quick decision matrix — when to reach for which

| Goal | Use | Why |
|---|---|---|
| Embed X/Twitter capabilities into a *different* project (bot, archiver, extension) | **rymalia/bird** as a library: `import { TwitterClient, resolveCredentials } from '@steipete/bird'` | Mixin TypeScript client; query-ID rotation handled; cookie extraction baked in; ~70 LOC of composition exposes the full surface |
| One-shot CLI from a shell or script: read a tweet, post a reply, scrape a thread, fetch likes/bookmarks | **bird CLI** (fork binary or published) | No setup beyond cookies; deterministic stdout; ideal for piping into `jq`/`grep`/agents |
| Anything involving **multiple reads, persistence, search, or revisiting** the same data | **birdclaw** | Reads are cached to SQLite; repeat queries cost zero live API calls; FTS5 over the whole archive |
| **DM** triage, search, or reply | **birdclaw** | bird @ 0.8.1 has no DM support at all |
| **Block / unblock / mute / unmute** workflows (single or batch) | **birdclaw** | bird @ 0.8.1 has no moderation writes; birdclaw's 3-tier auto-fallback (bird → xurl → x-web cookie) is the only path that consistently lands block writes on X |
| **Importing a Twitter archive ZIP** | **birdclaw** | bird has no archive concept; birdclaw imports tweets/likes/bookmarks/DMs/follows idempotently with macOS Spotlight autodiscovery |
| **Identity / "who is this DM sender" / affiliation lookups** | **birdclaw `whois`** | bird has `about` (account origin) but nothing that ranks bio entities, affiliation badges, profile-URL evidence, etc. |
| **Follow graph** — mutuals, unfollows, churn over time | **birdclaw `graph` subcommands** | bird can list followers/following at a point in time; birdclaw keeps snapshots, edges, and append-only events |
| News / trending Explore tabs | **bird** | birdclaw doesn't expose this |
| Lists, list-timeline reads | **bird** | birdclaw doesn't expose this |
| `follow` / `unfollow` writes | **bird** | birdclaw doesn't expose follow-graph writes |
| Like/unlike/retweet/unretweet/bookmark *mutations* | **bird** (engagement mixin, 0.8.0) | birdclaw doesn't expose engagement writes |
| Posting a tweet or replying (low volume) | **bird** | birdclaw exposes `compose post/reply/dm` but routes through bird anyway; the bird CLI is the more direct path |
| Long-form analysis, AI inbox ranking, OpenAI summaries | **birdclaw** | bird has no AI layer |
| Git-friendly text backups of an entire Twitter history | **birdclaw `backup`** | JSONL shards, deterministic, push/pull through any Git remote |
| Scheduled / unattended background sync | **birdclaw `jobs install-bookmarks-launchd`** | launchd integration, audit log, lock file, env-file for credentials |

## The rymalia/bird fork: what it actually is

`/Users/rymalia/projects/bird/` — `@steipete/bird` **v0.8.1**, HEAD `4afcd6f` (2026-02-24), 337 commits, last public source state before steipete closed the repo. The `dev` branch tracks `rymalia/bird` with a thread-filter-flags PR (#2) merged into it.

**Architecture** (from `bird/CLAUDE.md` + source):

```
TwitterClientBase (twitter-client-base.ts)
    + withMedia, withPosting, withTweetDetails, withSearch,
      withTimelines, withLists, withUsers, withEngagement,
      withFollow, withHome, withNews, withUserLookup,
      withUserTweets, withBookmarks
    = TwitterClient (twitter-client.ts, 71 LOC of composition)
```

Mixin-based TypeScript client over the **undocumented X web GraphQL API** with three-layer query-ID resilience:
- Baked-in IDs (`src/lib/query-ids.json`)
- Runtime cache (`~/.config/bird/query-ids-cache.json`, 24h TTL)
- Hardcoded fallback IDs for `TweetDetail` / `SearchTimeline`

Authenticates via `auth_token`/`ct0` cookies extracted from Safari/Chrome/Firefox via `@steipete/sweet-cookie`. Falls back to `statuses/update.json` (v1.1 REST) when `CreateTweet` GraphQL returns "automated request" error 226.

**Commands at 0.8.1** (full surface from `src/cli/program.ts`):
`about · bookmarks · check · follow · home · likes · list-timeline · lists · mentions · news · query-ids · read · replies · reply · search · thread · tweet · unbookmark · unfollow · user-tweets · whoami`

**What this fork uniquely provides**:

- A complete, *open-source*, post-source-deletion copy of bird's internals (`twitter-client-*.ts` mixins) that can be embedded as a library — `import { TwitterClient, resolveCredentials } from '@steipete/bird'`.
- A 60 MB compiled Bun binary (`/Users/rymalia/projects/bird/bird`) — though it's from 0.8.0 (Feb 22), one commit behind `dev` HEAD.
- The thread-filter-flags work merged from PR #2 (`--author-chain`, `--author-only`, `--rooted-thread`, `--thread-meta`) — these shipped in 0.8.1's CHANGELOG.

## birdclaw: what it actually is

`/Users/rymalia/projects/birdclaw/` — `birdclaw` **v0.4.1**, also by `@steipete`. Status: WIP but real and usable.

**Architecture**: TanStack Start app + Commander CLI sharing `src/lib/` (~100 modules). SQLite canonical store. Three live transports glued by `actions-transport.ts`:

```
                    ┌─ xurl.ts ──→ shells out to `xurl` CLI ──→ X v2 API (OAuth2)
runModerationAction ─┼─ bird.ts ──→ shells out to bird CLI ────→ X GraphQL (cookie)
                    └─ x-web.ts ─→ direct fetch + sweet-cookie ─→ x.com/i/api/1.1
```

Each transport's read paths normalize to the same shape (`XurlMentionsResponse` — `{data, includes, meta}`) so downstream code is transport-blind. `normalizeBirdTweets()` in `src/lib/bird.ts:285` is where bird's `{id,text,author,…}` gets reshaped.

### bird subcommands birdclaw expects

| Birdclaw call                               | Where                  | In 0.8.1 fork?                  |
| ------------------------------------------- | ---------------------- | ------------------------------- |
| `bird mentions -n N --json`                 | `bird.ts:330`          | ✅                              |
| `bird likes --json [--all --max-pages]`     | `bird.ts:370`          | ✅                              |
| `bird bookmarks --json [--all --max-pages]` | `bird.ts:387`          | ✅                              |
| `bird home -n N --json --following`         | `bird.ts:421`          | ✅ (0.7.0+)                     |
| `bird thread <id> --json [--all]`           | `bird.ts:438`          | ✅ (0.7.0+)                     |
| `bird read <id> --json`                     | `bird.ts:413`          | ✅                              |
| `bird dms -n N --json`                      | `bird.ts:462`          | ❌ **missing**                  |
| `bird user <q> --json --profile-only`       | `bird.ts:497`          | ❌ **`--profile-only` missing** |
| `bird user <q> -n 1 --json` (fallback)      | `bird-actions.ts:126`  | ❌ no top-level `user` cmd      |
| `bird profiles <…ids> --json`               | `bird.ts:578`          | ❌ **missing**                  |
| `bird status <q> --json`                    | `bird-actions.ts:57`   | ❌ **missing**                  |
| `bird block/unblock/mute/unmute <q>`        | `bird-actions.ts:187+` | ❌ **missing**                  |

**Consequence**: those subcommands do not exist in any public bird release — not in the rymalia/bird fork, not on npm (frozen at 0.8.0), not on Homebrew (tap mirrors the npm release). They appear to live only in steipete's private development environment. On any public user's machine, the bird-transport surface for `dms`, `profiles`, `user --profile-only`, `status`, `block`, and `mute` is non-functional, and birdclaw's auto-fallback silently re-routes those calls through `xurl` or `x-web`. The failures are silent: birdclaw never reports "the bird transport for DMs is unavailable", it just delegates. A reader of birdclaw's source would conclude bird supports those surfaces; a reader of bird's source would conclude it doesn't. **Both are right; they're looking at different snapshots.**

**Recommended setup**: skip Homebrew (it would not improve the situation — same 0.8.0 with same gaps). Use the rymalia/bird fork's globally-linked binary, pinned explicitly via `~/.birdclaw/config.json` so launchd-scheduled jobs and non-shell contexts can resolve it. Details below.

### Setup using the rymalia/bird fork — the working ceiling on public bird

birdclaw resolves bird through `src/lib/config.ts → getBirdCommand()` in this order:

1. `BIRDCLAW_BIRD_COMMAND` env var (explicit override)
2. `mentions.birdCommand` in `~/.birdclaw/config.json`
3. First `bird` on `PATH`
4. Hardcoded last-resort fallback: `~/Projects/bird/bird` *(case-insensitive macOS FS resolves `~/projects/bird/bird` too — a maintainer-personal default leaking into the source)*

Use step 2 (config-file pin) as the primary mechanism. Step 1 (env var) works for one-off overrides. Step 3 (PATH) works for interactive shells but **not** for launchd-scheduled jobs (the `jobs sync-bookmarks` agent runs with a minimal PATH that omits nvm-managed bins). Step 4 is the trap — it ships with the maintainer's home layout assumption baked in and should not be relied on.

**Step 1 — confirm what `bird` resolves to right now:**

```bash
which -a bird                            # every bird on PATH, in order
ls -l "$(which bird 2>/dev/null)"        # symlink target tells you what's installed
bird --version                           # 0.8.1 (4afcd6f0) = the rymalia fork at dev HEAD
```

Following the bird CLAUDE.md install recipe (`npm link --force`) yields a symlink chain `bin/bird → ../lib/node_modules/@steipete/bird/dist/cli.js`, with `lib/node_modules/@steipete/bird` itself a symlink to `~/projects/bird/`. Verify the link target with `ls -la /Users/rymalia/.nvm/versions/node/v24.12.0/lib/node_modules/@steipete/bird` — if it's a symlink (not a real directory), edits to the fork's `dist/cli.js` reach the global `bird` command instantly without rebuild/reinstall.

**Step 2 — pin birdclaw to the absolute path of the fork's symlink:**

```bash
mkdir -p ~/.birdclaw && cat > ~/.birdclaw/config.json <<'EOF'
{
  "mentions": { "birdCommand": "/Users/rymalia/.nvm/versions/node/v24.12.0/bin/bird" },
  "actions":  { "transport": "auto" }
}
EOF
```

The absolute path makes resolution unambiguous in every context (interactive shell, scheduled launchd job, child processes that scrub PATH). If the active nvm Node version changes, this path moves — one line to update. A more durable alternative is to point at the fork's compiled Bun binary at `/Users/rymalia/projects/bird/bird` (no Node runtime needed, no nvm coupling), but note it's one commit behind dev HEAD and won't have your thread-filter-flags work until you rebuild it (`cd ~/projects/bird && pnpm run build:binary`).

For per-shell or per-invocation overrides:

```bash
export BIRDCLAW_BIRD_COMMAND=/Users/rymalia/.nvm/versions/node/v24.12.0/bin/bird
# One-off, e.g. to test the compiled Bun binary directly:
BIRDCLAW_BIRD_COMMAND=~/projects/bird/bird birdclaw …
```

**Step 3 — install birdclaw's own deps and verify resolution:**

```bash
cd ~/projects/birdclaw

# birdclaw requires Node >=25.8.1 <27; the .node-version file pins exact.
# The fork bird at the nvm v24 path keeps working regardless — they don't share runtime.
nvm install "$(cat .node-version)"
nvm use "$(cat .node-version)"

# Node 23+ unbundled Corepack from the default install (formerly bundled since 16.10).
# Install it explicitly, then enable pnpm so it reads birdclaw's `packageManager` pin.
npm install -g corepack
corepack enable pnpm
pnpm --version                           # should print 10.31.0 (matches birdclaw's pin)

pnpm install                             # installs tsx + the rest into node_modules
pnpm cli auth status --json              # exercises getBirdCommand() and reports xurl health
```

> **Heads-up — pnpm 10 → 11 update banner.** `pnpm install` prints an "Update available! 10.31.0 → 11.1.0" notice. **Do not follow it.** birdclaw's `package.json` pins `"packageManager": "pnpm@10.31.0"`; Corepack honors that pin. Running `corepack use pnpm@11.1.0` would diverge from birdclaw's version and risk lockfile drift. Let upstream birdclaw bump the pin first.

**Step 4 — first-run verification.** The following commands were validated end-to-end during the 2026-05-11 setup session:

```bash
# Local DB stats — confirms SQLite init and shows seed data
pnpm cli db stats --json
# Expected: home: 4, mentions: 2, dms: 4, inbox: 4 (these are seeded demo rows from src/lib/seed.ts;
# delete ~/.birdclaw/birdclaw.sqlite to reset to empty before importing your real archive)

# Bird direct check — confirms cookie auth + GraphQL transport
/Users/rymalia/.nvm/versions/node/v24.12.0/bin/bird whoami
# Expected: handle, X user id, "graphql" transport, cookie source (e.g. Chrome default)

# Bird-routed birdclaw call — confirms birdclaw → bird via the config.json pin
pnpm cli mentions export --mode bird --limit 3 --refresh
# Expected: JSON with `data` array of mentions in the normalized {data, includes, meta} shape

# xurl-routed birdclaw call — confirms OAuth2 v2 API path
pnpm cli mentions export --mode xurl --limit 6 --refresh
# Expected: JSON with `data` array of mentions
# Note: xurl REQUIRES --limit between 5 and 100 (enforced by src/lib/mentions-live.ts:48,
# reflecting X v2 API page-size constraints). Bird has no such floor.

# Web UI — TanStack Start app with seeded data
pnpm exec vite dev --port 3001    # use this form to keep package.json clean of port edits
# Visit http://localhost:3001/
```

If a bird-routed command works but xurl fails (or vice versa), it's an auth/cookie problem for that transport — not a setup problem. `bird whoami` and `xurl auth status` tell you which side is unhealthy.

**Step 5 — know what's actually broken under bird**, so there are no surprises. These birdclaw paths route through bird and will silently fall back to xurl/x-web because the bird subcommands don't exist in any public bird:

| birdclaw command | bird subcommand it wants | Where it actually goes |
|---|---|---|
| `birdclaw dms sync` | `bird dms --json` | falls back to xurl (X v2 API DMs) |
| `birdclaw search dms --resolve-profiles` | `bird user --profile-only --json`, `bird profiles --json` | falls back to local cache → xurl |
| `birdclaw whois` (with bird hydration) | same as above | falls back to local cache → xurl |
| `birdclaw ban / unban @x --transport bird` | `bird block / unblock`, `bird status` | falls back to xurl, then x-web cookie |
| `birdclaw mute / unmute @x --transport bird` | `bird mute / unmute`, `bird status` | falls back to xurl |

These features still work end-to-end through birdclaw, just not via bird. Don't waste time debugging "why isn't bird handling DMs" — bird publicly cannot.

### Three orthogonal ways to use the fork

The same physical checkout at `~/projects/bird/` plays three roles, all simultaneously:

- **As the global `bird` command** — via `npm link --force` (current state). PATH lookups and birdclaw's `getBirdCommand()` resolve through the nvm bin symlink. Edits to `dist/cli.js` propagate instantly.
- **As an importable library for other projects** — `import { TwitterClient, resolveCredentials } from '@steipete/bird'` resolves to the project's own `node_modules` copy of the fork (or the published 0.8.0 if the project pulls from npm). The global link doesn't affect this.
- **As a source workspace for active development** — `cd ~/projects/bird && pnpm run dev <args>` runs `tsx src/index.ts <args>` against current source without touching the global symlink. Use this for trying changes before committing.

There is no "dev fork vs. installed bird" tension to manage, because they're the same thing. The only setup nuance is the absolute-path pin in `~/.birdclaw/config.json` so launchd jobs can resolve bird without relying on PATH.

### One-shell summary (verified 2026-05-11)

```bash
# 1. Pin birdclaw to the fork's nvm-linked bird command.
mkdir -p ~/.birdclaw && cat > ~/.birdclaw/config.json <<'EOF'
{
  "mentions": { "birdCommand": "/Users/rymalia/.nvm/versions/node/v24.12.0/bin/bird" },
  "actions":  { "transport": "auto" }
}
EOF

# 2. Switch to birdclaw's required Node version (Node 25.8.1 per .node-version).
cd ~/projects/birdclaw
nvm install "$(cat .node-version)" && nvm use "$(cat .node-version)"

# 3. Node 23+ unbundled Corepack; install + enable, then install birdclaw deps.
npm install -g corepack
corepack enable pnpm
pnpm install

# 4. Verify end-to-end.
pnpm cli auth status --json
pnpm cli db stats --json
/Users/rymalia/.nvm/versions/node/v24.12.0/bin/bird whoami
pnpm cli mentions export --mode bird --limit 3 --refresh
pnpm cli mentions export --mode xurl --limit 6 --refresh

# 5. Launch the web UI (use the exec form to avoid editing package.json's port).
pnpm exec vite dev --port 3001
# → http://localhost:3001/
```

## Capability comparison at equivalent surface

What each *system* can do against X, with birdclaw's other two transports included:

| Capability                          | bird fork @ 0.8.1 (alone)                          | birdclaw (with all transports)                                                                                      |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Read tweet / thread / replies       | ✅ paginated, with thread filter flags             | ✅ via bird, plus live ancestor lookup; cached to SQLite                                                            |
| Search tweets                       | ✅ paginated GraphQL                               | ✅ **FTS5 over local archive** + xurl live; date ranges; quality filters; `--liked`/`--bookmarked` filters          |
| Mentions                            | ✅ live, paginated                                 | ✅ paged xurl + bird; cached; replied/unreplied filters; agent-friendly normalized JSON export                      |
| Likes / Bookmarks                   | ✅ live read, paginated                            | ✅ live sync to SQLite; dedicated web views; archive-imported history; backup                                       |
| DMs                                 | ❌ none in 0.8.1 source                            | ✅ list, sync, search, two-column UI; FTS5; sender bio + influence; whois lookup; reply                             |
| Home timeline                       | ✅ For You / Following                             | ✅ stored + displayed; low-quality filtering; replied filters                                                       |
| Compose: tweet / reply              | ✅ + REST fallback for error 226                   | ✅ via bird (`compose post/reply/dm`)                                                                               |
| Following / Followers               | ✅ live list                                       | ✅ **cache-first follow graph** + snapshots + churn events + mutuals/unfollows queries; backup                      |
| Follow / Unfollow                   | ✅ + REST cursor fallback                          | ❌ not exposed (bird-only)                                                                                          |
| Like/Unlike/Retweet/Bookmark mutate | ✅ via engagement mixin (0.8.0)                    | ❌ not exposed                                                                                                      |
| Block / Unblock                     | ❌ none in 0.8.1                                   | ✅ **3-tier auto-fallback** (bird → xurl → x-web cookie); local mirror; batch blocklist import; verify-after-mutate |
| Mute / Unmute                       | ❌ none in 0.8.1                                   | ✅ bird + xurl auto-fallback; verify-after-mutate                                                                   |
| News / Trending Explore             | ✅ AI-curated tabs (0.7.0)                         | ❌ not exposed                                                                                                      |
| Lists (`list-timeline`, `lists`)    | ✅                                                 | ❌ not exposed                                                                                                      |
| `about` (account origin)            | ✅ (0.8.0)                                         | ❌ not directly; `whois` does richer identity                                                                       |
| Identity / whois                    | ❌                                                 | ✅ profile snapshots, affiliation badges, bio entities, `--current-affiliation`/`--exclude-domain-only` filters     |
| Archive import (Twitter ZIP)        | ❌                                                 | ✅ tweets/likes/bookmarks/DMs/follows; idempotent reruns; Spotlight autodiscovery on macOS                          |
| Backup / restore (Git-friendly)     | ❌                                                 | ✅ JSONL shards (per-year tweets, per-conversation DMs); push/pull; stale-aware auto-sync                           |
| Scheduled sync                      | ❌                                                 | ✅ launchd 3h bookmark job + audit log + lock file                                                                  |
| AI inbox / ranking                  | ❌                                                 | ✅ OpenAI scoring; reason codes; low-signal filter                                                                  |
| Link insights                       | ❌                                                 | ✅ HN-style top URLs across day/week/month/year; rich previews; `t.co` short-link index + `search links`            |
| Profile reply-pattern scan          | ❌                                                 | ✅ `profiles replies` for AI-slop triage                                                                            |
| **Storage**                         | None — every call hits X                           | SQLite — agent reads stay local; `--refresh` to spend an API call                                                   |
| **Cookie / auth surface**           | Browser cookies via sweet-cookie                   | bird does cookie; xurl does OAuth2 v2; x-web uses sweet-cookie again as last-resort                                 |
| **Architecture**                    | Mixin TypeScript client                            | Three-transport adapter façade + canonical SQLite                                                                   |
| **Distribution**                    | npm + Bun binary + Homebrew                        | npm + Homebrew                                                                                                      |
| **Open source today**               | Fork is the only surviving copy of the source     | Repo is open at `steipete/birdclaw`                                                                                 |

## Reuse — leveraging X access methods in other projects

**rymalia/bird — value as an embeddable library.**
`import { TwitterClient, resolveCredentials } from '@steipete/bird'` gets a fully-typed GraphQL client with query-ID rotation, mixin composition, cookie extraction, and REST fallback in ~70 LOC of composition. The mixin pattern is genuinely good — each capability is a self-contained file with its own GraphQL operation and types, composing onto a base class. For adding an X capability to a non-birdclaw project (a bot, a different archiver, a Chrome extension), this is the path.

**birdclaw — value as a transport orchestration template.**
What's worth borrowing isn't bird's internals (the fork already has those); it's the **adapter façade pattern** in `actions-transport.ts` plus the **normalization layer** in `bird.ts`'s `normalizeBirdTweets()`. By reshaping bird's `{id, text, author}` into xurl's `{data, includes, meta}`, downstream code branches on neither transport. That's the trick to making a multi-transport system maintainable — copy that pattern into any project where there are two ways to fetch the same kind of object.

**Pattern worth stealing #2**: the `BIRDCLAW_DISABLE_LIVE_WRITES=1` kill switch. Every write path checks it; tests and CI set it automatically. A single env-gated escape hatch is the cheapest possible safety net for a tool that talks to a third-party service.

**Pattern worth stealing #3**: cache-first sync, with `--refresh` as the only explicit "spend an API call" gesture. Read commands fill SQLite then serve from it; agents can hammer the CLI without paying for repeated X calls. This is the architectural decision that makes birdclaw safe to give to an LLM.

## Git-log narrative — how the two repos relate over time

- **bird repo** (rymalia fork): 337 commits, last source state `4afcd6f` 2026-02-24. CHANGELOG shows a steady arc — 0.1.0 (2025-12-20) → 0.8.0 (npm) → 0.8.1 (local version-label bump on the rymalia fork). Features added across that arc: `home`/`news`/`user-tweets`/`follow`/`unfollow`/`engagement`/`about`/`thread-filter-flags`. No DMs, no moderation writes, no batch profiles, no status query. Most contributions in the later versions come from external PRs (@the-vampiire, @citizenlee, @pjtf93, etc.), consistent with steipete preparing to close the source — community contributions stop, then the repo goes private.
- **`@steipete/bird` on npm**: 9 published releases, **frozen at 0.8.0** (verified 2026-05-11 via `npm view @steipete/bird versions`). The package has not received a new release since the source repo closed.
- **birdclaw repo**: 40+ recent commits visible; CHANGELOG shows 0.1.0 (2026-04-27) → 0.4.1 (2026-05-11) — so birdclaw was first published **roughly two months after the bird snapshot froze**. Reconstructed timeline of that gap:
  1. Closed/privated `steipete/bird`
  2. Added `dms`, `profiles`, `user --profile-only`, `status`, `block`/`mute` commands to bird **privately** — never published
  3. Opened `steipete/birdclaw` built against this private bird, but birdclaw's source still calls those subcommands as if they exist publicly
  4. As of the snapshot date, public bird remains at 0.8.0 with none of those commands

The birdclaw 0.4.x CHANGELOG hints at this without acknowledging it: *"Use `bird profiles --json` for batch profile hydration when available, falling back to single-profile `bird user --profile-only --json`."* Neither `bird profiles` nor `bird user --profile-only` exists in any public bird — the "when available" clause is doing load-bearing work. In practice these paths always fall back to xurl on a public user's machine.

## Common framings vs what's actually true

| Common framing                                         | What's actually true                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "birdclaw quietly included bird within it"             | birdclaw shells out to bird as one of three external transport adapters; no source was copied                                                                                                                |
| "this new version of bird is better and more featured" | **birdclaw-as-product** is dramatically more featured than **bird-as-CLI**, but bird itself is now a subordinate transport — the right framing is *bird is a component, birdclaw is the system that uses it* |
| "this fork is the most recent open-source version of bird" | Stronger than that: the fork at 0.8.1 is *the* working ceiling on public bird, anywhere. Public npm froze at 0.8.0 and the fork carries 0.8.0 + one additional commit (thread-filter-flags). No newer public bird exists.                                                                       |
| "steipete moved bird private but kept publishing it"   | Half-true. He moved bird private, but stopped publishing it in parallel — `@steipete/bird` on npm froze at 0.8.0 the same week the source went away. The newer subcommands birdclaw uses (`dms`, `profiles`, `status`, `block`, `mute`) exist only in his private dev environment.       |
| "Homebrew install would fix the missing-subcommand gaps" | False. The Homebrew tap mirrors the npm release; installing it gives 0.8.0 with the same gaps. Use the rymalia fork; it's strictly equal-or-better than anything publicly installable.                                                                       |
| "leverage these access methods elsewhere"              | The fork is the library to import; birdclaw's `actions-transport.ts` is the orchestration pattern to copy                                                                                                    |

The rymalia/bird fork is **the most complete public bird that exists**. Its limits relative to birdclaw's expectations (no DMs, no batch profiles, no moderation writes) aren't a forkedness problem — they're the limits of *all* public bird. Don't expect to close those gaps by installing a different bird; they get closed by birdclaw's other two transports (`xurl`, `x-web`).

## When this doc goes stale — signals to re-verify

This is a point-in-time snapshot. The most load-bearing assertion in it — *public `@steipete/bird` is frozen at 0.8.0* — is the cheapest one to re-verify. Run this first if any of the recommendations below feel off:

```bash
npm view @steipete/bird version       # has the registry advanced past 0.8.0?
npm view @steipete/bird versions      # show every published release for context
```

If 0.8.0 is no longer the latest, the entire doc needs re-reading — the "fork is the working ceiling" claim flips, the recommended setup may shift to the newer published bird, and birdclaw's bird-transport gaps for DMs / profiles / moderation may close themselves.

Other signals that change the picture:

- **birdclaw advances past 0.4.x.** Check `CHANGELOG.md` for new transports, new bird subcommand dependencies, or a switch away from subprocess-based bird invocation (e.g. if steipete ever bundles bird as a library import — `pnpm-lock.yaml` would grow an `@steipete/bird` entry as a runtime dep).
- **The `steipete/bird` source returns to public** (or a credible mirror surfaces). That would erase the "fork is the most complete public bird" claim and likely come with a new npm release stream.
- **A new transport adapter appears in `src/lib/`** of birdclaw — a fourth alongside `xurl`, `bird`, `x-web` (e.g. a direct X v2 client without the `xurl` subprocess hop). Would shift the transport routing recommendations.
- **X breaks bird.** Cookie-auth GraphQL is fundamentally fragile (see bird's own README warning). If `bird` stops working at the cookie level, the `xurl` path inside birdclaw becomes the only working transport and this doc's framing changes substantially.

To re-derive the "bird subcommands birdclaw expects" table:
```bash
cd /Users/rymalia/projects/birdclaw
grep -n "runBirdJsonCommand(\[\|runBirdCommand(\[" src/lib/bird.ts src/lib/bird-actions.ts
```

To re-derive what's in the *currently-installed* bird:
```bash
bird --help 2>&1 | grep -iE "dms|profiles|block|mute|^  status"
```
If that grep returns matches, the installed bird has features beyond what this doc assumes — re-check sections "bird subcommands birdclaw expects" and "Common framings".

To check whether birdclaw still uses bird as a subprocess (vs. bundling it as a library):
```bash
grep -n "@steipete/bird" /Users/rymalia/projects/birdclaw/pnpm-lock.yaml
grep -rn "from ['\"]@steipete/bird\|TwitterClient" /Users/rymalia/projects/birdclaw/src
```
Any hits flip the "no source copied" finding and the doc's architecture section needs revision.

To re-derive the "bird subcommands birdclaw expects" table:
```bash
cd /Users/rymalia/projects/birdclaw
grep -n "runBirdJsonCommand(\[\|runBirdCommand(\[" src/lib/bird.ts src/lib/bird-actions.ts
```

To check whether birdclaw bundles bird as a library (the original premise check):
```bash
grep -n "@steipete/bird" /Users/rymalia/projects/birdclaw/pnpm-lock.yaml
grep -rn "from ['\"]\\.\\./.*bird\\|TwitterClient" /Users/rymalia/projects/birdclaw/src
```

If either of those starts returning hits, the "no source copied" finding is no longer true.
