---
date: 2026-05-11
time: "3:14 PM PDT – 8:27 PM PDT"
project: birdclaw
---

# Session Summary: birdclaw onboarding + bird relationship analysis

## Overview

First-contact session with the newly-cloned `birdclaw` repo. Went from the question *"is bird bundled inside birdclaw?"* to a fully running local-first Twitter workspace with a verified setup, an authoritative `CLAUDE.md` for future Claude Code sessions, and a comprehensive `bird` vs `birdclaw` reference document intended as the team's onboarding artifact for these two related projects.

## The Question That Started It

> *"This `birdclaw` repo started as `bird`. The maintainer (@steipete) closed his `bird` source, and now he's released `birdclaw` and quietly included `bird` within it? I'd like to confirm that, and understand the comparison."*

The premise turned out to be wrong in an interesting and load-bearing way. Surfacing that early changed every subsequent decision.

## Key Findings — bird vs birdclaw

The full comparison lives in [`docs/assessment-bird-vs-birdclaw_2026-05-11.md`](./assessment-bird-vs-birdclaw_2026-05-11.md) (~330 lines). For onboarding purposes, the load-bearing facts:

1. **`birdclaw` does NOT bundle `bird`.** It contains a ~640-line subprocess adapter (`src/lib/bird.ts`) that `execFile`s `bird` as one of three external transports. Three independent confirmations: `pnpm-lock.yaml` has no `@steipete/bird` entry; the adapter uses `execFile`, never `import`; the error string says *"Install @steipete/bird or set BIRDCLAW_BIRD_COMMAND..."*.

2. **Public `@steipete/bird` is frozen at 0.8.0** (verified via `npm view @steipete/bird versions` → 9 releases, max 0.8.0, no newer ever shipped). The source repo went private around the same week. **The `bird` npm package stopped publishing in parallel with the source going private.**

3. **The rymalia/bird fork at 0.8.1 is the working ceiling on public `bird`, anywhere.** 0.8.1 = 0.8.0 source + the thread-filter-flags PR #2 + a local version-label bump. There is no newer public `bird` to upgrade to.

4. **`birdclaw` calls bird subcommands that don't exist publicly** — `bird dms`, `bird profiles`, `bird user --profile-only`, `bird status`, `bird block / unblock / mute / unmute`. These exist only in steipete's private dev environment. `birdclaw` silently routes those calls through `xurl` or the `x-web` cookie fallback. A reader of `birdclaw` source would conclude `bird` supports those surfaces; a reader of `bird` source would conclude it doesn't. **Both are right; they're looking at different snapshots.**

5. **The two artifacts are at different layers.** `bird` = transport library + CLI (stateless, single GraphQL transport). `birdclaw` = local-first workspace (SQLite canonical store, FTS5 search, web UI, AI inbox, archive import, three transports, follow graph, identity/whois). The right framing: *bird is a component, birdclaw is the system that uses it.*

6. **Reuse story for other projects in the team's portfolio**:
   - Embedding X capabilities elsewhere → `import { TwitterClient, resolveCredentials } from '@steipete/bird'` from the fork. The mixin pattern is genuinely good.
   - Multi-transport orchestration → copy `birdclaw`'s `actions-transport.ts` adapter façade + `normalizeBirdTweets()` normalization layer. That's the trick to making N transports look like one to downstream code.
   - Cache-first read pattern with `--refresh` as the only "spend an API call" gesture → also worth stealing for any agent-facing CLI talking to a third-party API.

## Key Decisions Made

| Decision | Rationale |
|---|---|
| Skip Homebrew `brew install steipete/tap/bird` | Homebrew tap mirrors npm; would give 0.8.0 with the same gaps. The rymalia fork at 0.8.1 is strictly equal-or-better than anything publicly installable. |
| Use the existing `npm link`'d fork as the global `bird` | Was already in place from following bird's `CLAUDE.md`; the symlink chain (`bin/bird → lib/node_modules/@steipete/bird → ~/projects/bird`) means edits to the fork's `dist/cli.js` propagate to the global `bird` instantly. |
| Pin `bird` via absolute path in `~/.birdclaw/config.json` (not env var, not PATH) | Survives across shells AND launchd-scheduled jobs (the `jobs sync-bookmarks` agent runs with a minimal PATH that omits nvm bins). |
| Run `birdclaw` on Node 25.8.1, `bird` on Node 24.12.0 — asymmetric runtimes | They never share a runtime; pinning `bird`'s path absolutely makes this stable. Avoided unnecessary Node-version conflicts. |
| Install Corepack manually (`npm install -g corepack`) | Node 23+ unbundled Corepack from the default install. The `corepack enable pnpm` recipe most blogs publish silently fails on Node 25 without this step. |
| Don't edit `birdclaw`'s `src/lib/config.ts` to fix the hardcoded `~/Projects/bird/bird` fallback | Pointless (macOS case-insensitivity makes it work anyway) and creates merge conflicts on every upstream `git pull`. Override from outside the source tree instead. |
| Use `pnpm exec vite dev --port 3001` for the dev server | Same reasoning — don't edit `package.json` to change the port; pass the flag at invocation time to keep the local diff clean for upstream sync. |
| Revise the assessment doc twice during the session | (1) After verifying `npm` registry contradicted my "newer bird must exist" inference; (2) After end-to-end smoke tests validated the setup commands. Doc reflects what is actually true on this machine. |

## Changes Made

| Change | Detail |
|--------|--------|
| **`CLAUDE.md` created** | `/Users/rymalia/projects/birdclaw/CLAUDE.md` — orientation for future Claude Code sessions; covers commands, the three-transport architecture, cache-first sync invariants, SQLite/FTS5 data model, tooling quirks (`tsgo` vs `tsc`, oxlint+oxfmt), and the doc/code drift around the aspirational `packages/*` layout |
| **Assessment doc created + revised twice** | `docs/assessment-bird-vs-birdclaw_2026-05-11.md` — full bird-vs-birdclaw reference with YAML frontmatter, decision matrix, capability comparison, install playbook, timeline reconstruction, common-framing corrections, and stale-doc re-verification commands |
| **`~/.birdclaw/config.json` created** | Pins `mentions.birdCommand` to the absolute fork-symlink path; sets `actions.transport: auto`. Survives shell and launchd contexts. |
| **Node 25.8.1 installed via nvm** | Required by birdclaw's `package.json` engines field (`>=25.8.1 <27`) and `.node-version` |
| **Corepack installed globally** under Node 25 | `npm install -g corepack` (Node 23+ unbundled it from default install); `corepack enable pnpm` resolves the `packageManager: "pnpm@10.31.0"` pin in `birdclaw`'s `package.json` |
| **birdclaw dependencies installed** | 313 packages via pnpm 10.31.0; 166 reused from existing pnpm content-addressed store, 147 newly downloaded (including platform-specific native binaries tied to Node 25's ABI) |
| **`package.json` port edit attempted then reverted** | User initially edited the `dev` script port from 3000 → 3001; reverted in favor of `pnpm exec vite dev --port 3001` at invocation time |

## Testing / Verification Performed

Verified end-to-end on this machine:

| Smoke test | Outcome | What it confirmed |
|---|---|---|
| `npm view @steipete/bird version` | `0.8.0` | Public npm is frozen at 0.8.0; no newer release exists |
| `npm view @steipete/bird versions` | 9 releases, max 0.8.0 | Confirms the freeze; reveals 0.5.0 missing (likely unpublished) |
| `ls -la /Users/rymalia/.nvm/versions/node/v24.12.0/lib/node_modules/@steipete/bird` | Symlink to `~/projects/bird` | The global `bird` IS the rymalia fork via `npm link` |
| `bird --version` | `0.8.1 (4afcd6f0)` | Confirms running fork HEAD; SHA matches `git log` on rymalia/bird `dev` |
| `bird --help` | No `dms`, `profiles`, `status`, `block`, `mute` subcommands | Confirms those features genuinely don't exist in public bird |
| `pnpm cli auth status --json` (under Node 25) | `availableTransport: "xurl"`, OAuth2 user `ryanmalia`, bearer ✓ | xurl transport healthy |
| `pnpm cli db stats --json` | home: 4, mentions: 2, dms: 4, inbox: 4 | SQLite initialized with seed demo data from `src/lib/seed.ts` |
| `/Users/rymalia/.nvm/versions/node/v24.12.0/bin/bird whoami` | `@ryanmalia (16281489)` via Chrome cookies, GraphQL transport | bird transport healthy with cookie auth |
| `pnpm cli mentions export --mode bird --limit 3 --refresh` | Returned real X mentions in normalized `{data, includes, meta}` shape | bird-routed birdclaw path works end-to-end via the config.json pin |
| `pnpm cli mentions export --mode xurl --limit 6 --refresh` | Returned real X mentions | xurl-routed path works against the X v2 API |
| `pnpm exec vite dev --port 3001` | Vite 8 ready in 784ms; SSR client connected | Web UI live at `http://localhost:3001/` with seed data renderable |

## Summary Statistics

- **Session duration**: ~5 hours 13 minutes (3:14 PM – 8:27 PM PDT)
- **Files created**: 3 (`CLAUDE.md`, `docs/assessment-bird-vs-birdclaw_2026-05-11.md`, `~/.birdclaw/config.json`)
- **Doc revisions to the assessment doc**: 2 major (post-npm-registry-correction; post-smoke-tests)
- **Major misconceptions corrected**: 3 (bird-is-bundled, newer-bird-must-exist, Homebrew-would-help)
- **Smoke tests executed**: 11 (all passing)
- **bird subcommand audit**: 12 calls catalogued in `birdclaw` → matched against public `bird` 0.8.1; 6 confirmed missing publicly
- **Software installed**: Node 25.8.1, Corepack (global), pnpm 10.31.0 (via Corepack), 313 birdclaw deps
- **Reference / source files audited**: ~15 across both repos (`birdclaw/src/lib/{bird,bird-actions,actions-transport,xurl,x-web,config,db,sqlite}.ts`, `bird/src/lib/twitter-client*.ts`, both `package.json`s, both `CHANGELOG.md`s, both `README.md`s, bird's `cli/program.ts`)

## Discoveries / Handoff Notes

The non-obvious gotchas a future session (or another team member touching `bird` or `birdclaw`) would otherwise have to re-discover:

**Public `bird` is end-of-life, even though it doesn't say so.** Steipete moved the source private *and stopped publishing to npm in parallel.* The "no recent commits but the package is still there" pattern is easy to mistake for a maintained package that just hasn't shipped recently. It hasn't shipped since 0.8.0 went up and isn't going to.

**The rymalia/bird fork is uniquely valuable as a snapshot.** It's the last open-source state of bird's internals (TwitterClient mixins, query-ID rotation, sweet-cookie integration, REST fallback). For other projects in the team's portfolio that depend on `@steipete/bird`, this fork is the authoritative reference if upstream ever needs to be patched or replaced.

**`birdclaw`'s `bird`-transport surface is partially aspirational.** Don't waste time debugging "why isn't `bird` handling DMs / profiles / moderation" — it publicly cannot. The auto-fallback to `xurl` and `x-web` is what actually delivers those features on any public user's machine.

**`getBirdCommand()` has a maintainer-personal hardcoded fallback** to `~/Projects/bird/bird` (capital P, but macOS case-insensitivity papers over). It's a "works on @steipete's machine" leak — coincidentally also works on rymalia's machine, but should not be relied on. Pin explicitly via `~/.birdclaw/config.json`.

**Asymmetric Node runtimes are working as designed.** `bird` lives under Node 24.12.0 via `npm link`; `birdclaw` runs on Node 25.8.1. The absolute path in `config.json` makes this stable across shells, terminals, and launchd-scheduled jobs. Don't try to "unify" them.

**Node 23+ unbundled Corepack** from the default install. Most "use Corepack for pnpm" guides still say "Corepack ships with Node" — outdated as of Node 23. On every fresh Node 23+ install, manual `npm install -g corepack` is required before `corepack enable pnpm` works.

**xurl mode requires `--limit 5–100`** — hard-enforced in `src/lib/mentions-live.ts:48`. This reflects the X v2 API's page-size contract, not a birdclaw choice. bird-mode has no such floor (`--limit 3` works fine there).

**`pnpm install` prints an "Update to pnpm 11.1.0" banner — ignore it.** birdclaw pins `"packageManager": "pnpm@10.31.0"`; Corepack honors that pin. Running `corepack use pnpm@11.1.0` as the banner suggests would diverge from birdclaw's version and risk lockfile drift.

**`node:sqlite` graduated from experimental between Node 24 and Node 25.** The `ExperimentalWarning: SQLite is an experimental feature` line appears under Node 24 but not Node 25. This is why `birdclaw`'s engines field is `>=25.8.1` — it dropped `better-sqlite3` for the native built-in and that floor is what made it stable.

**The `.node-version` floor isn't arbitrary.** Each minor Node version's `node:sqlite` API may have subtle behavioral diffs; both the floor and the `<27` ceiling reflect that.

**Don't edit upstream source files to fit local environment.** Two temptations resisted this session: editing `src/lib/config.ts` to lowercase `~/projects/bird/bird`, and editing `package.json`'s dev script to change ports. Both create merge conflicts on every upstream `git pull`. Override from outside (`~/.birdclaw/config.json`, `pnpm exec vite dev --port 3001`) instead.

## Current State

**Filesystem:**
- `~/projects/birdclaw/` — clean working tree on `main`; new `CLAUDE.md` and `docs/assessment-bird-vs-birdclaw_2026-05-11.md`; this session-summary file
- `~/projects/bird/` — rymalia fork, dev HEAD `4afcd6f`, `npm link`ed globally under Node 24
- `~/.birdclaw/birdclaw.sqlite` — initialized with seed demo data (4 home / 2 mentions / 4 DMs / 4 inbox)
- `~/.birdclaw/config.json` — pins `birdCommand` to `/Users/rymalia/.nvm/versions/node/v24.12.0/bin/bird`, `actions.transport: auto`

**Runtimes:**
- nvm-managed: Node 24.12.0 (where global `bird` lives) AND Node 25.8.1 (where birdclaw runs)
- Corepack: installed globally under Node 25.8.1 only
- pnpm: 10.31.0 via Corepack under Node 25 (matches birdclaw's `packageManager` pin)
- Active default nvm version: still Node 24.12.0 (user did not run `nvm alias default 25.8.1`)

**Auth state:**
- `xurl`: OAuth2 authenticated as `@ryanmalia`, client `go-getter`, bearer token present
- `bird`: cookie auth working via Chrome default profile, X user id `16281489`

**Web UI:**
- Running at `http://localhost:3001` via `pnpm exec vite dev --port 3001` during the session (likely stopped post-session)

**Git state:**
- `birdclaw` branch `main`, clean working tree at session start. New uncommitted files: `CLAUDE.md`, `docs/assessment-bird-vs-birdclaw_2026-05-11.md`, this session summary
- `bird` branch `dev` at `4afcd6f`, ahead of `main`

## Reference Documents Produced

For the team — the two artifacts to bookmark from this session:

1. **`docs/assessment-bird-vs-birdclaw_2026-05-11.md`** — The bird-vs-birdclaw comparison and decision reference. Includes:
   - YAML frontmatter with verified version data (public bird frozen at 0.8.0 as of 2026-05-11)
   - Quick decision matrix: "when to reach for which tool"
   - Three-correction TL;DR for the common misconceptions
   - Capability comparison at equivalent surface (~25 rows)
   - `bird` subcommand audit: which calls birdclaw makes, which exist publicly, which don't
   - Verified installation playbook (Steps 1–5 with end-to-end smoke tests)
   - Reuse patterns: how to leverage bird-the-library and birdclaw-the-architecture in other projects
   - Common-framings table with corrected versions of the obvious-but-wrong takes
   - "When this doc goes stale" with concrete re-verification commands

2. **`CLAUDE.md`** — Orientation for future Claude Code sessions in `birdclaw`. Covers commands, the three-transport architecture, cache-first sync as a load-bearing invariant, SQLite/FTS5 data model, and the doc/code drift in `docs/data-architecture.md`'s aspirational `packages/*` layout.

## Unfinished Work / Next Steps

None of these are blocked — they're follow-ups whenever the user is ready:

- **Import a real Twitter archive.** The web UI currently shows seed demo data. `pnpm cli archive find --json` will autodetect via macOS Spotlight; `pnpm cli import archive --json` to import; `pnpm cli import hydrate-profiles --json` to fill in live profile data.
- **Live syncs.** `pnpm cli sync likes / bookmarks / timeline / mention-threads` to populate the canonical SQLite store with current X state.
- **Configure backup repo** (`~/.birdclaw/config.json` → `backup` block) if Git-friendly JSONL backups are desired.
- **Install the launchd scheduled bookmark sync job** (`pnpm cli jobs install-bookmarks-launchd --program ...`) for unattended 3-hour bookmark refreshes.
- **Consider `nvm alias default 25.8.1`** if running `birdclaw` commands frequently — would avoid having to `nvm use 25.8.1` per shell. Side-effect: changes default Node for other projects too.
- **Consider an `nvmrc` cd-hook in `~/.zshrc`** for auto-switching Node version on `cd ~/projects/birdclaw`.
- **Consider contributing a PR upstream to `birdclaw`** removing the maintainer-personal `~/Projects/bird/bird` fallback in `src/lib/config.ts`. Would benefit future fresh-Mac clones.

## For the Dev Team — Quick Reference

If you're approaching this for the first time:

- **"Is the `bird` I use in project X going to work with `birdclaw`?"** Probably yes for reads (`mentions`, `likes`, `bookmarks`, `home`, `thread`, `read`). Probably no for DMs / profile hydration / moderation writes via the bird path — those routes fall back to `xurl` inside birdclaw. See `docs/assessment-bird-vs-birdclaw_2026-05-11.md` § "bird subcommands birdclaw expects".
- **"Is there a newer `bird` I should be tracking?"** No. Public `@steipete/bird` froze at 0.8.0; the source repo is gone. The rymalia/bird fork at 0.8.1 is the working ceiling. See § "Git-log narrative".
- **"Can I embed bird's internals in another project?"** Yes — `import { TwitterClient, resolveCredentials } from '@steipete/bird'` from the rymalia fork. See § "Reuse".
- **"How do I install birdclaw from scratch?"** Follow § "One-shell summary (verified 2026-05-11)" in the assessment doc — 5 steps, ~5 minutes.
- **"What does birdclaw add over bird?"** SQLite canonical store, FTS5 search, web UI, AI inbox, archive import, follow graph history, identity/whois, Git-friendly backups, scheduled launchd jobs, plus two additional transports (xurl for OAuth2 v2 API; x-web for cookie fallback). See § "TL;DR — three corrections to a common framing" point 2.
- **"What patterns from birdclaw are worth stealing for other projects?"** The multi-transport adapter façade in `actions-transport.ts`; the `normalizeBirdTweets()` cross-transport shape unification; cache-first reads with `--refresh` as the only API-spending verb; `BIRDCLAW_DISABLE_LIVE_WRITES=1` as a single env-gated kill switch.
