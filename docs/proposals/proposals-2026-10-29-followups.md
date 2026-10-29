# Proposals for review — 2026-10-29

Drafted at the end of session `dfdd5f3e` to review tomorrow. Nothing here has been started beyond what each item states. They're ordered by how ready they are. Context: `docs/session-summaries/session-summary-2026-10-29-x-archive-media-fix.md` and `session-summary-2026-10-29-wrapup-dm-fix-proposals.md`.

---

## 1. Open the upstream PR for the web DM fix — *ready, waiting on a go-ahead*

**State:** commit `f78c167` on `fix/x-web-viewer-provided-variables`, pushed to `origin`. Two Codex passes (FIX, then SHIP after the fixes); `check` clean; Node 26.12.1 and Bun 1.4.4 each 1964/1964; shipped-CLI before/after against the real account: `main` returns 422, the fix returns `ok: true`.

**What it fixes:** every `dms sync --mode web` fails with HTTP 422. `src/lib/x-web.ts` sends a Relay provided variable for X's `viewerQuery` (`__relay_internal__pv__appviewerisloggedinprovider`) that X renamed (`…xclientsfeaturesappviewerisloggedinrelayprovider`). The fix reads the names from the bundle instead of hardcoding one.

**Steps:**
1. `gh pr create --repo steipete/birdclaw --base main --head rymalia:fix/x-web-viewer-provided-variables --title "fix: send the viewer query's current Relay provided variables" --body-file docs/proposals/pr-draft-x-web-viewer-provided-variables.md`
2. Add the CHANGELOG line under `0.16.4 - Unreleased`, ending `(#NNN — thanks @rymalia)`, as its own commit, then push again (the same pattern as #254's `cdd4f0e`).
3. Watch ClawSweeper; `@clawsweeper re-review` after the CHANGELOG push if wanted.

**Decide:** open as-is? The PR draft's "before" section quotes the real 422 body from X. It's X's generic validation message and names no account, but check it before posting.

---

## 2. Store tweet language (`lang`) — *small, upstream-worthy*

**Finding:** `lang` is dropped from both sources:
- xurl's `tweet.fields` omits it (`src/lib/xurl.ts:966`; `lang` is a standard X v2 tweet field).
- `normalizeBirdTweets()` (`src/lib/bird.ts:565`) builds each tweet from a fixed set of fields that doesn't include it.
- There's no `tweets.lang` column.

**Proposal:**
- Request `lang` in xurl's tweet-field lists.
- Add `lang?: string` to `BirdTweetItem` and pass it through the normalizer as v2's `lang`.
- Add a nullable `tweets.lang` column (migration in `database-migrations.ts`), written on upsert as `coalesce(excluded.lang, tweets.lang)` so a source without it doesn't clear it.

**Why:** it works for both sources and is cheap. As a field on the tweet it adds nothing to the API bill. It enables "filter by language" search and makes later translation work possible.

**Open questions:**
- Expose it in `search tweets` (`--lang`) and the web UI now, or only store it?
- Backfill for archive tweets: the archive's `tweets.js` has `lang` on each authored tweet. Is it parsed? Unverified.

---

## 3. Bookmark save time (`bookmarkedAt`) → `tweet_collections.collected_at` — *needs a direction decision*

**Finding:**
- Bird 0.9.0 (your fork) emits `bookmarkedAt`; `normalizeBirdTweets()` drops it.
- Live syncs always write `collected_at = null` (`src/lib/tweet-repository.ts:117`).
- X's official API (xurl) doesn't return bookmark time, so bird is the only possible source.
- Current DB: 5 xurl bookmarks with `collected_at` null; 120,913 archive likes all at `1970-01-01T00:00:00.000Z` (a placeholder; `like.js` has no timestamps).

**Proposal:**
- Pass `bookmarkedAt` through the normalizer as a birdclaw-specific field.
- Have the collection upsert set `collected_at` only when the stored value is null or the 1970 placeholder, so a known date is never overwritten.

**Decide:**
- **Upstream or fork-only?** No public bird emits `bookmarkedAt`; steipete's private bird might. A PR would need to be framed as optional passthrough. A fork-only change goes against the "don't carry source edits on `dev`" note.
- **Routing:** it only arrives when bird serves bookmarks. In `auto`, bookmarks go xurl → bird, so dates need `--mode bird` (or `auth prefer bird`). Is that acceptable?

---

## 4. `isTranslatable` — *recommend: don't store*

It depends on the logged-in account (X sets it when it would offer *that* account a Translate button), so it doesn't belong in the account-shared `tweets` table. If it's ever needed, compute it at read time from `lang` against the viewer's language. Listed only so it's a deliberate decision.

---

## 5. First real bookmark backfill — *ready to run, costs a little*

Only 5 bookmarks are stored (archives don't include them). The bounded first run:

```
bun run cli sync bookmarks --mode auto --limit 100 --max-pages 20 --early-stop --refresh --json
```

xurl caps pages at 90, so this is about 1,800 bookmarks at most. Cost is about $0.001 per post read (an Owned Read), so roughly $1.80. Expansions are free until **2026-11-22**, so run it before then.
- **Continue** with `--pagination-token "$NEXT_TOKEN" --mode xurl` if there's more.
- **Unknowns:** how far back X goes (X has cited the most recent 800 in the past; unverified here), and whether a sync removes local bookmarks you've since un-bookmarked on X (unchecked).

**Decide:**
- Run it via xurl now (no save dates), or wait for proposal 3 and run via bird to get `bookmarkedAt`?
- Ordering: proposal 3 first if save dates matter. Otherwise a later bird pass could still fill the dates in, if proposal 3 is written to fill empty values.

---

## 6. Housekeeping

- **#254:** optional `@clawsweeper re-review` (the verdict is pinned to `326efad`, before the changelog-only `cdd4f0e`). Both #253 and #254 are waiting for steipete to approve CI (`action_required`).
- **After merges:** sync `dev` with upstream; remove the `birdclaw-archive-media` and `birdclaw-xweb-viewer` worktrees and branches. Until the DM fix merges, run web DM reads from `birdclaw-xweb-viewer`.
- **Cleanup:** `~/.birdclaw/birdclaw.demo.sqlite*`; the unzipped archive folder in `~/Downloads/X-twitter-account-data-downloads/`.
- **Credential hygiene:** this session's transcript contains the live `auth_token`/`ct0` values. Logging out of x.com in that browser invalidates them.
- **Small latent bug (not filed):** `listArchiveEntryDetailsEffect` joins the filename fields with single spaces (`parts.slice(9).join(" ")`), so archive filenames with runs of spaces would be mangled. Not seen in X archives; could be a test-first PR if wanted.
- **Mentions:** `sync mention-threads` needs local mentions, and archives have none. A periodic `sync mentions --latest` (or the `jobs` runner) is needed before mention threads do anything.
