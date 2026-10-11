#!/bin/bash
# Seeds the public demo on Tiramisu. Keys are read from a JSON file OUTSIDE the repo:
#   { "issuer": {"privateKey": "0x…"}, "forger": {...}, "witness": {...} }
# usage: demo/seed.sh /path/to/wallets.json
set -euo pipefail
cd "$(dirname "$0")/.."
K="${1:?wallets json}"
key() { node -e "console.log(require('$K')['$1'].privateKey)"; }
run() { LAPSE_PRIVATE_KEY="$(key "$1")" node cli/lapse.mjs "${@:2}"; }
echo "== issuer: Example VPN renews (due in 14 days, 7-day grace)"
run issuer issue example-vpn --name "Example VPN (demo)" \
  --statement "Example VPN (a fictional demo service) has not received any secret subpoena, gag order or National Security Letter as of $(date -u +%F)."
echo "== issuer: Dead Drop Mail issues a short-lived canary it will never renew"
run issuer issue dead-drop-mail --name "Dead Drop Mail (demo)" --due-minutes "${DDM_DUE:-10}" --grace-minutes "${DDM_GRACE:-5}" \
  --statement "Dead Drop Mail (a fictional demo service) has received no secret legal orders as of $(date -u +%F)."
echo "== forger: posts a fake all-clear under example-vpn"
run forger forge example-vpn
echo "== witness: attests that both canaries were alive"
run witness witness example-vpn --note "seen alive by independent witness"
run witness witness dead-drop-mail --note "seen alive shortly before it was abandoned"
echo "== check"
node cli/lapse.mjs check example-vpn || true
node cli/lapse.mjs check dead-drop-mail || true
