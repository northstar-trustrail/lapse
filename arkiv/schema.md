# Lapse data contract on Arkiv

Network: **Tiramisu testnet**, chain id `7738577`, RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
SDK: `@arkiv-network/sdk` 0.8.1. Source of truth for every builder: [`core/lapse.js`](../core/lapse.js).

Every Lapse entity carries `project = "lapse-v1"` and a `type`. All data is synthetic: demo issuers are fictional services, and no personal data, secrets or keys are ever written to Arkiv (plaintext or hashed).

## Trust model

- The **trust root** is a file only the domain owner can edit: `https://<issuer-domain>/.well-known/lapse.json`, mapping an issuer slug to a wallet. The demo binding lives at [`web/public/.well-known/lapse.json`](../web/public/.well-known/lapse.json), served at https://northstar-trustrail.github.io/lapse/.well-known/lapse.json.
- A canary counts only if its **`$creator`** equals the bound wallet. `$creator` is set by the engine and never changes, while the `issuer` attribute is just a string anyone can copy. Entities with the right `issuer` but another creator are shown as **FORGED**.

## Entity types

### `canary`: one renewal of a warrant canary

| Field | Type | Notes |
|---|---|---|
| `project` | str | `lapse-v1` |
| `type` | str | `canary` |
| `issuer` | str | issuer slug, e.g. `example-vpn` (`^[a-z0-9][a-z0-9.-]{0,63}$`) |
| `seq` | u64 | increments on each renewal |
| `issued_at` | u64 | ms since epoch |
| `due_at` | u64 | ms since epoch; when the next renewal is due (range-queried) |
| `statement_hash` | bytes32 | sha256 of the statement text |
| payload | application/json | `{v, issuer, seq, statement, statementHash, issuedAt, dueAt, graceMs}`; statement capped at 16 KiB |

- **Entity Expiration:** `ExpirationTime.atDate(dueAt + grace, { atLeast: fromSeconds(60) })`. Demo: `example-vpn` is due every 14 days with a 7-day grace; `dead-drop-mail` is due after a few minutes with a short grace, so it lapses during judging/demo.
- **Flags:** `readonly: true` (a published statement can never be edited or back-dated), `permissionlessExtension: false` (only the issuer can keep it alive).

### `issuer`: issuer profile

| Field | Type | Notes |
|---|---|---|
| `project`, `type`=`issuer`, `issuer` | str | |
| payload | application/json | `{v, issuer, name, bindingUrl}` |

- **Entity Expiration:** 90 days. **Lifetime Extension:** every `lapse issue` extends it by another 90 days in the **same atomic batch** as the new canary (`executeBatch`), so an issuer profile lives as long as the issuer is active.
- **Flags:** `readonly: true`.

### `witness`: "I saw canary #N alive at block B"

| Field | Type | Notes |
|---|---|---|
| `project`, `type`=`witness`, `issuer` | str | |
| `canary` | key | entity key of the canary that was seen (weak reference: it will dangle once the canary lapses, which is the point) |
| `canary_seq` | u64 | |
| `seen_at` | u64 | ms |
| `seen_block` | u64 | Tiramisu block height at observation |
| payload | application/json | `{v, issuer, canaryKey, canarySeq, seenAt, seenBlock, note}` |

- **Entity Expiration:** 180 days.
- **Flags:** `readonly: true`, `permissionlessExtension: true`, so anyone (not only the witness) can keep the evidence alive after the canary itself is gone. Nobody can change it.

## Queries the app runs

All queries are built in [`core/lapse.js`](../core/lapse.js) and printed verbatim (`builder.toString()`) in the web UI.

1. **Trusted canaries of an issuer** (CLI `check`, web status):
   ```
   project = str('lapse-v1') AND type = str('canary') AND issuer = str('example-vpn') AND $creator = addr(0x2e6C27eE29865110beb601175bF628b1230F4eF1)
   ```
   SDK: `select(...).where(eq("project",…), eq("type",…), eq("issuer",…)).createdBy(wallet).limit(200)`.
2. **Everything claiming to be an issuer** (any creator, used to detect forgeries): query 1 without `$creator`. Results whose creator ≠ bound wallet are FORGED.
3. **Canaries not yet due:** query 1 `AND due_at > u64(now)` (range on a numeric attribute).
4. **Witnesses for an issuer:** `project = 'lapse-v1' AND type = 'witness' AND issuer = …`.
5. **Issuer profile of the signing wallet** (before a batch): `type = 'issuer' AND issuer = … AND $creator = me`.
6. **Live events:** `watchEntityEvents` over the WebSocket transport (created / extended / patched / deleted).

Results are paginated with `page.next()` (max 200/page). There is no server-side ordering, so the client sorts by `seq`.

## Status logic (client side, `classify()`)

- **ALIVE**: newest trusted canary exists and `due_at > now`.
- **OVERDUE**: newest trusted canary is past `due_at` but still within its grace (entity not yet expired).
- **LAPSED**: no live canary from the bound wallet. Arkiv removed it at its Entity Expiration. Silence is the signal.
- **FORGED**: entity with the right `issuer` string but the wrong `$creator`. It never counts towards ALIVE.

## Kept off Arkiv on purpose

- The slug-to-wallet binding: it must be controlled by the domain owner, so it lives on the domain (`/.well-known/lapse.json`).
- Private keys (env var `LAPSE_PRIVATE_KEY` only), any personal data, and anything secret.
- Long documents: only the short statement and its hash go in the payload.
