# Lapse: warrant canaries that die loudly

**Live app:** https://northstar-trustrail.github.io/lapse/ · **Network:** Arkiv Tiramisu testnet (chain 7738577) · **License:** MIT
Built for the Arkiv Global Tour Stop (Oct 9–18, 2026). Tracks: **Security**, **Censorship Resistance**, **Open Source**.

## The problem
VPNs, encrypted-mail providers and hosts publish *warrant canaries*: "we have received no secret subpoenas or gag orders", renewed on a schedule. If the canary stops being renewed, users should assume the worst. Today a canary is just a page on the provider's own website, so it can be:
- **silently edited or back-dated**, because the operator controls the page and its history;
- **taken down along with the site**, so "it stopped" and "the site is down" look the same;
- **forged** by a look-alike mirror or account posting a fake "all clear";
- **missed**, since nobody is watching a static page for a renewal that didn't happen.

The people who rely on canaries most (journalists, activists, at-risk users) get a signal they can't verify.

## How Lapse works
1. **A canary is an Arkiv entity** created by the provider's wallet. Its **Entity Expiration = next renewal deadline + grace**. If the provider stops renewing, Arkiv removes it from the query surface by itself. No cron job, no server, nobody to pressure into keeping it up.
2. **Trust comes from `$creator`.** The provider binds a wallet to its domain in `https://<domain>/.well-known/lapse.json`. Lapse only counts canaries whose immutable `$creator` is that wallet. A canary with the same `issuer` attribute from any other wallet is shown as **FORGED**.
3. **Canaries are `readonly`**, so a published statement can never be rewritten or back-dated, and `permissionlessExtension: false`, so only the issuer can keep them alive.
4. **Witnesses** (anyone) post `witness` entities: "I saw canary #N alive at block B". They are `permissionlessExtension: true`, so the community can keep the evidence alive after the canary itself is gone.
5. **No backend.** The web app and the CLI query the public Tiramisu RPC directly; the web app also streams `watchEntityEvents` over WebSocket.

Statuses: **ALIVE** (renewed, not yet due) · **OVERDUE** (due date passed, still in grace) · **LAPSED** (no live canary from the bound wallet) · **FORGED** (right name, wrong creator).

The data contract is in [`arkiv/schema.md`](arkiv/schema.md). Our honest friction log is in [`arkiv/friction.md`](arkiv/friction.md).

## Setup
Requires Node 20+ (developed on Node 24).
```bash
git clone https://github.com/northstar-trustrail/lapse && cd lapse
npm ci
npm test                       # unit tests (schema builders, status logic, exact query text)
npm run build                  # builds the static web app into web/dist
python3 -m http.server -d web/dist 8080   # or any static server; open http://localhost:8080
```

## CLI
```bash
node cli/lapse.mjs check example-vpn        # read-only, no wallet needed
node cli/lapse.mjs check dead-drop-mail
node cli/lapse.mjs watch                    # live Arkiv entity events over WebSocket
# writes need a funded Tiramisu test wallet (https://hub.arkiv.network/faucet) in an env var:
LAPSE_PRIVATE_KEY=0x... node cli/lapse.mjs issue my-service --due-minutes 20160 --grace-minutes 10080
LAPSE_PRIVATE_KEY=0x... node cli/lapse.mjs witness example-vpn
```
`check` exit codes are made for monitors: `0` ALIVE, `1` OVERDUE, `2` LAPSED, `3` UNKNOWN, `4` only forgeries. `--binding <url|file>` points at a different `/.well-known/lapse.json`.

## Reproduce our Arkiv usage (for judges)
1. Open https://northstar-trustrail.github.io/lapse/. Each demo issuer shows its status, the canary statement, its Entity Expiration block, forgeries, witnesses and the **exact query** under "Exact Arkiv query".
2. Or run it yourself without our site: `npm ci && node cli/lapse.mjs check example-vpn`. The query it sends is:
   ```
   project = str('lapse-v1') AND type = str('canary') AND issuer = str('example-vpn') AND $creator = addr(0x2e6C27eE29865110beb601175bF628b1230F4eF1)
   ```
3. Look up the writer wallets on the explorer (https://tiramisu.explorer.arkiv.network):
   - `0x2e6C27eE29865110beb601175bF628b1230F4eF1`: **issuer** (demo providers "Example VPN" and "Dead Drop Mail")
   - `0xD90DAD33Afc160728b05400703c5Db0436ac1B3c`: **forger-demo** (posts a fake all-clear under `example-vpn`; shown as FORGED)
   - `0xE70b553505D0B3f0bf8de89720EFD24f192AAD74`: **witness** (independent attestations)
4. Seed your own copy: `demo/seed.sh <wallets.json>` (keys file kept outside the repo) issues both canaries, forges one, and witnesses both. "Dead Drop Mail" uses a canary that is due in minutes and is never renewed, so you can watch it go OVERDUE and then LAPSED.

## Layout
- `core/lapse.js`: schema constants, entity builders, query builders, status logic (shared by CLI and web)
- `cli/lapse.mjs`: `check`, `issue`, `witness`, `forge` (demo), `watch`
- `web/`: static app (esbuild bundle), deployed to GitHub Pages; `web/public/.well-known/lapse.json` is the demo binding
- `demo/seed.sh`: seeds the demo on Tiramisu
- `arkiv/schema.md`, `arkiv/friction.md`

## Data and safety
Only synthetic data goes to Arkiv: fictional services and boilerplate canary statements. No personal data, no secrets, no keys. Private keys only ever live in the `LAPSE_PRIVATE_KEY` env var.

## Disclosure
Built Oct 10–18, 2026 by Northstar Trustrail with an AI coding agent writing the code. No pre-existing project code. Third-party libraries: `@arkiv-network/sdk`, `viem`, `esbuild`.
