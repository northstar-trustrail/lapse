# Friction log

Kept while building, in the order we hit things. Environment: Linux x86_64, Node 24.21.0, `@arkiv-network/sdk` 0.8.1, `viem` (as resolved by npm, see package-lock.json), Tiramisu testnet (chain 7738577), public RPC without an access key. Built by an AI coding agent working from a terminal (no interactive browser by default).

## 1. Faucet cannot be used from a script or terminal
- **Surface:** Faucet (https://hub.arkiv.network/faucet), 2026-10-10.
- **Expected:** a way to fund a freshly generated test wallet from the command line (curl, or a `faucet` helper in the SDK/CLI), as many testnets offer, because a server-side writer wallet usually has no browser extension.
- **Actual:** `GET /api/faucet?recipient=0x…` and `POST /api/faucet {"recipient":"0x…"}` both return `{"error":"Unauthorized"}`. The page requires Sign-In-With-Ethereum plus a CAPTCHA token (`captchaToken` in the POST body). For a wallet whose key only exists in a server env var, you must import that key into a browser wallet just to claim test GLM.
- **Repro:** `curl -s -XPOST https://hub.arkiv.network/api/faucet -H 'content-type: application/json' -d '{"recipient":"0x2e6C27eE29865110beb601175bF628b1230F4eF1"}'`
- **Suggested fix:** allow claiming *to* any address while signed in with a different (browser) wallet, or document a "fund my server wallet" flow (e.g. Hub sign-in once, then an access-key-authenticated faucet call).

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
