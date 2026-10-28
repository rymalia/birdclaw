---
session_id: 225822b6-5140-414a-9f92-98b2b7dd1dc4
date: 2026-10-28
time: "2:02 AM PDT – 2:25 AM PDT"
project: birdclaw
branch: dev
---

# Session Summary: nvm default back to Node 24; birdclaw uses `nvm use`; docs link fixed

> **Metadata note:** this session started in the `~/projects` workspace and moved into this
> repo for the docs fix. The full machine-level record is
> `~/projects/docs/session-summaries/session-summary-2026-10-28-node-default-back-to-24.md`.
> The end time is when the collector ran; the commit came just after it.

## Overview

The nvm default that the 2026-10-27 session set to Node 26.12.1 is now **24.22.1** again.
Switching the default had hidden every global CLI (all of them, including qmd, live under
v24). birdclaw still runs on 26.12.1 through its local `.nvmrc`, but it now needs a manual
`nvm use`. Also fixed a docs link that broke when session summaries were moved into
`docs/session-summaries/`.

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **Default 24.22.1; birdclaw switches with `nvm use`** | The 20 global CLIs and 4 `npm link`s are all under v24. birdclaw's `engines.node` is `>=26.5.1 <27`, but only its `*:node` scripts use nvm's Node; `dev`/`test`/`build` run on Bun |
| **No `.nvmrc` auto-switch hook** (user's call) | Run `nvm use` by hand in this repo instead |
| **`~/.local/bin/bird` left alone** | It resolves `nvm which default` at run time and needs only Node ≥ 22, so it now runs on v24 and works (0.8.1) |
| **Fixed the link, not the checker** | The checker was right: the link target was `./` but the file lives one level up |

## Changes Made

| Change | Detail |
|--------|--------|
| **nvm default (outside the repo)** | `~/.nvm/alias/default`: `26.12.1` → `24.22.1` |
| **Docs link** | `docs/session-summaries/session-summary-2026-05-11-birdclaw-bird-onboarding.md:21`: `./assessment-bird-vs-birdclaw_2026-05-11.md` → `../assessment-bird-vs-birdclaw_2026-05-11.md`. Broken since `32717ab` moved the summaries |
| **This summary** | Committed with the link fix |

## Testing / Research Performed

- **Clean-env login shell** (`env -i … zsh -lic`), in this repo:
  - `nvm use` → v26.12.1; `node bin/birdclaw.mjs --version` → 0.16.3.
  - `~/.local/bin/bird --version` → `0.8.1 (40fc843c)` on the v24 default.
- **`npm run test:node` on v26.12.1, before the fix:** 1,955 passed and 7 skipped; 180 of 181 files passed. The one failing file was `src/docs-site.test.ts`: `broken docs links: session-summaries/session-summary-2026-05-11-birdclaw-bird-onboarding.html: assessment-bird-vs-birdclaw_2026-05-11.html -> missing`.
- **After the fix:**
  - `node scripts/build-docs-site.mjs` → `built docs site: dist/docs-site`.
  - `run-vitest.mjs run src/docs-site.test.ts` → 1 file, 7/7 passed.
  - The full suite was not re-run.
- **Native addons checked:** `node_modules/**/*.node` are all N-API platform prebuilds (lightningcss, rolldown, oxfmt, oxlint, tailwind oxide, sharp, fsevents), so they don't depend on the Node ABI.
- **Codex gpt-5.6-luna (high):** a read-only review of the link fix, also asked to look for other relative links that broke in the move and that the checker might miss. Verdict **SHIP**: the new target resolves, and it is the only relative Markdown link in `docs/session-summaries/`.

## Summary Statistics

- Repo files changed: 1 (+ this summary)
- Broken links fixed: 1
- Test files: 181 run, 1 failed (now fixed and re-run alone)

## Discoveries / Handoff Notes

- **The 2026-10-27 summary's "nvm default 26.12.1" is no longer true.** Don't rely on it.
- `node_modules/.pnpm/` is leftover from before the switch to Bun. It's harmless.
- The tracked `.node-version` (25.8.1, upstream's) is ignored by nvm; the local-only `.nvmrc` (26.12.1) is what counts.

## Unfinished Work

- Run `nvm use` in this repo before any `*:node` script (`dev:node`, `test:node`, `build:node`, `e2e:node`, …).
- Optional: re-run the full `test:node` suite to confirm 181/181 files.
- Still open from 2026-10-27: X archive import before any live sync (see memory `project-pending-x-archive`). The flaky timeline test is addressed by open PR #253 ("give the large timeline render case a 30s timeout").
