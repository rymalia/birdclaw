## Summary

Every native web DM read (`dms sync --mode web`) currently fails before it reaches the inbox, with `X web request failed (HTTP 422)`.

- Before any DM request, `XWebSession.verifyAccount` confirms the signed-in account through X's GraphQL `viewerQuery`. It sends a hardcoded Relay provided variable, `__relay_internal__pv__appviewerisloggedinprovider`.
- X's current web bundle (`startup-*.js`, viewerQuery id `Ouqgpqn9ihXpKGhjVeQPoQ`) declares a different one: `providedVariables:{__relay_internal__pv__xclientsfeaturesappviewerisloggedinrelayprovider:Ed}`. The old name appears nowhere in the bundle.
- X therefore rejects the query with `422 GRAPHQL_VALIDATION_FAILED`, `"must be defined"`, `path: ["variable", "__relay_internal__pv__xclientsfeaturesappviewerisloggedinrelayprovider"]`.
- Query-id and bearer discovery still work: the request gets past authentication and fails only on validation.
- Provenance: the hardcoded variable was introduced with the native web transport in `368f569` (#209).

## Change

`src/lib/x-web.ts`:

- **Discover the provided variables.** During the existing public-client discovery, read the provider names from the viewerQuery operation's `providedVariables` and send each as `true`. The viewer query only runs for a signed-in session, so the one provider declared today ("is logged in") is `true`. If a bundle declares none, fall back to the current known name. This replaces one hardcoded name with whatever the bundle declares, so the next rename shouldn't break DMs again.
- **Keep the match inside the viewer operation.** The gap between `params:{id:` and `name:viewerQuery` can no longer span into another operation's `params:{` block. The same match now also selects the variable names, so pairing one operation's id with another's name would send the wrong query id. (Codex review finding.)
- **Rediscover after a GraphQL 422.** A 422 on a `/i/api/graphql/` path now clears the cached public client, the same as 401/404. A long-running `serve` process then rediscovers after X changes the query instead of failing until restart. The failing call still throws, so `verifyAccount` still fails closed.

## Tests

`src/lib/x-web-dms.test.ts`:

- **Updated:** the existing module-discovery test, whose fixture declares no `providedVariables`, now expects the fallback name.
- **New: "sends the provided variables the discovered viewer query declares".** It uses the real bundle's backtick-quoted shape with two declared providers, preceded by a compact unrelated `otherQuery` operation. It asserts the request goes to the viewer query's id with exactly the declared variables. It fails with the old regex, which pairs the other operation's id with the viewer query's name.
- **New: "rediscovers the public client after X rejects the viewer query variables".** The first `verifyAccount` gets a 422 and rejects; a second session rediscovers (the bundle is fetched twice) and succeeds. It fails without the 422 cache reset.

## Proof

Shipped entry point (`node bin/birdclaw.mjs`, after `bun run build`) on both revisions, run against a real account with `AUTH_TOKEN`/`CT0` set. Output is reduced to status fields; no message content or credentials are shown.

- **before** = `main` @ `a08c264` (this PR's base)
- **after** = this PR @ `f78c167`
- macOS 26.7.1, 8 CPUs, Node v26.12.1

| Run | Result |
|---|---|
| **before** | **exit 1**, `X web request failed (HTTP 422)` |
| **after** | **exit 0**, `ok: true`, `source: web`, 1 conversation, 1 message |

<details>
<summary>before — main @ a08c264</summary>

```text
# before  2026-10-29T12:07:03Z  head a08c264  node v26.12.1  macOS 26.7.1
$ node bin/birdclaw.mjs --json dms sync --mode web --inbox accepted --limit 1 --max-pages 0 --refresh | jq -c "{ok,source,conversations,messages}"
{"error":"X web request failed (HTTP 422)"}
exit 1
```

The underlying response, captured by wrapping `fetch` to log only the request path, the status, and the error body:

```text
GET https://x.com/i/api/graphql/<id>/viewerQuery -> 422  body: {"errors":[{"code":"GRAPHQL_VALIDATION_FAILED","extensions":{"code":"GRAPHQL_VALIDATION_FAILED"},"message":"must be defined","path":["variable","__relay_internal__pv__xclientsfeaturesappviewerisloggedinrelayprovider"]}]}
failed: X web request failed (HTTP 422)
```
</details>

<details>
<summary>after — this PR @ f78c167</summary>

```text
# after  2026-10-29T12:07:03Z  head f78c167  node v26.12.1  macOS 26.7.1
$ node bin/birdclaw.mjs --json dms sync --mode web --inbox accepted --limit 1 --max-pages 0 --refresh | jq -c "{ok,source,conversations,messages}"
{"ok":true,"source":"web","conversations":1,"messages":1}
exit 0
```
</details>

## Verification

- `bun run check` (oxfmt, oxlint, tsc): pass
- Full Node suite (`bun run test:node`, Node v26.12.1): 181/181 files, 1964/1964 tests
- Full Bun suite (`bun run test`, Bun 1.4.4): 181/181 files, 1964/1964 tests
- `bun run test src/lib/x-web-dms.test.ts`: 30/30. Each new test fails with its corresponding fix removed.
