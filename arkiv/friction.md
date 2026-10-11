# Friction log

Kept while building, in the order we hit things. Environment: Linux x86_64, Node 24.21.0, `@arkiv-network/sdk` 0.8.1, `viem` (as resolved by npm, see package-lock.json), Tiramisu testnet (chain 7738577), public RPC without an access key. Built by an AI coding agent working from a terminal (no interactive browser by default).

## 1. Faucet: no documented way to fund a server-side wallet
- **Surface:** Faucet / Hub (https://hub.arkiv.network/faucet), 2026-10-10.
- **Expected:** a documented way to fund a freshly generated writer wallet whose key lives only in a server env var (curl, or a `faucet` helper in the SDK), as many testnets offer.
- **Actual:** `GET/POST /api/faucet` without a session returns `{"error":"Unauthorized"}`. The page wants a browser wallet extension: with a valid session but no injected wallet it just shows "Connect wallet". We got it working by reading the Hub's JS bundle:
  1. Sign in with SIWE via the better-auth endpoints: `POST /api/auth/siwe/nonce {walletAddress, chainId: 7738577}`, sign the EIP-4361 message (statement "Sign in to Arkiv Hub.") with the key, then `POST /api/auth/siwe/verify {message, signature, walletAddress, chainId}`. This returns a session cookie.
  2. Solve the Cap proof-of-work CAPTCHA (`captchaEndpoint` from `GET /api/faucet`) with the official `@cap.js/widget`.
  3. `POST /api/faucet {recipient, captchaToken}` returns `202 {"accepted":true}`, and 10 GLM arrive within seconds (1-hour cooldown).
  None of this is documented, and the Cap server rejects the widget when it runs on another origin ("Failed to fetch"; the CORS allow-headers don't include `content-type`), so the widget had to run under the hub origin.
- **Repro:** `curl -s -XPOST https://hub.arkiv.network/api/faucet -H 'content-type: application/json' -d '{"recipient":"0x2e6C27eE29865110beb601175bF628b1230F4eF1"}'` returns Unauthorized.
- **Suggested fix:** document the SIWE + CAPTCHA flow for headless wallets, or let a signed-in browser user claim *to* any recipient address (the API already takes `recipient`).

## 2. Writing from an unfunded wallet fails with an opaque error
- **Surface:** TypeScript SDK `executeBatch` / `createEntity`, 0.8.1.
- **Expected:** an error that says "insufficient funds for gas" (what viem normally surfaces) so a newcomer knows to visit the faucet.
- **Actual:** `Transaction failed: Execution error without revert data`.
- **Repro:** generate a key with `viem/accounts.generatePrivateKey()`, do not fund it, run `LAPSE_PRIVATE_KEY=0x… node cli/lapse.mjs issue example-vpn`.
- **Suggested fix:** pre-flight `getBalance` in the wallet client (or map the node error) and throw an `InsufficientFundsError` that links to the faucet.

## 3. No event when an entity expires
- **Surface:** `watchEntityEvents` (SDK 0.8.1) and docs "What happens when an entity expires".
- **Expected:** our whole product is "a canary dying is the signal", so we hoped for an `onEntityExpired` handler next to `onEntityDeleted`.
- **Actual:** the handler set is created / patched / extended / ownership / deleted; the docs confirm "There is no event and no grace period". A watcher must track `expiresAt` itself and re-query when the block passes. (In plain JS an `onEntityExpired` key is simply never called, with no warning; TypeScript catches it.)
- **Repro:** create an entity with `ExpirationTime.fromSeconds(30)`, subscribe with all handlers, wait 30 s: nothing fires.
- **Suggested fix:** an expiry event (even a synthetic one emitted by the node at the expiry block), or an SDK helper `watchExpiry(keys)`.

## 4. Query text is easy to get, but not documented as such
- **Surface:** SDK query builder.
- **Expected/actual:** we wanted to show judges and users the exact query. The docs page on querying does not mention it, but the type definitions show `QueryBuilder.toString()` returns "the same text the node parses". It works well (`project = str('lapse-v1') AND … AND $creator = addr(0x…)`).
- **Suggested fix:** mention `toString()` in the Querying data docs; it is great for "verify it yourself" UIs.

## 5. Lifetime Extension in a batch works as documented
- **Surface:** `executeBatch` with `creates` + `extensions`, SDK 0.8.1.
- **Expected = actual:** renewal #2 of `example-vpn` created the new canary and extended the issuer profile in one transaction (tx `0x6be6aeaa0ba2b766a254c7415e1b03d4afb3b4383751a3f42f1ee719e876f003`, `extendedEntities` = profile key). Logged as a positive data point.
- **Minor:** `createEntity` returns `expiresAt`, but `executeBatch` returns only keys, so to show the new expiry we have to re-query.
