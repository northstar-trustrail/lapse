#!/usr/bin/env node
// Lapse CLI. Reads go straight to the public Tiramisu RPC; writes need LAPSE_PRIVATE_KEY in the env.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import * as L from "../core/lapse.js";

const DEFAULT_BINDING = "https://northstar-trustrail.github.io/lapse/.well-known/lapse.json";
const pub = createPublicClient({ chain: tiramisu, transport: http() });
const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : def; };
const json = (o) => JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);

function wallet() {
  const pk = process.env.LAPSE_PRIVATE_KEY;
  if (!pk) throw new Error("set LAPSE_PRIVATE_KEY (a funded Tiramisu test wallet)");
  return createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(pk) });
}
async function binding(slug) {
  const url = opt("binding", process.env.LAPSE_BINDING || DEFAULT_BINDING);
  const body = url.startsWith("http") ? await (await fetch(url)).json() : JSON.parse(readFileSync(url, "utf8"));
  const b = L.parseBinding(body, slug);
  if (!b) throw new Error(`no binding for ${slug} at ${url}`);
  return b;
}

async function check(slug) {
  const b = await binding(slug);
  const all = await L.fetchAll(L.allCanariesQuery(pub, slug));
  const r = L.classify({ entities: all, wallet: b.wallet });
  const latest = r.latest && { key: r.latest.key, seq: L.attr(r.latest, "seq"), dueAt: new Date(Number(L.attr(r.latest, "due_at"))).toISOString(), expiresAtBlock: r.latest.expiresAt, statement: r.latest.toJson?.().statement };
  console.log(json({ issuer: slug, boundWallet: b.wallet, status: r.status, latest, forged: r.forged.map((e) => ({ key: e.key, creator: e.creator })), query: L.queryText(pub, slug, b.wallet) }));
  process.exitCode = r.forged.length && r.status !== "ALIVE" ? L.EXIT.FORGED : L.EXIT[r.status];
}

async function issue(slug) {
  const w = wallet();
  const statement = opt("statement", `As of ${new Date().toISOString().slice(0, 10)}, ${slug} has received no secret subpoenas, gag orders or National Security Letters.`);
  const dueMs = Number(opt("due-minutes", 60 * 24 * 14)) * 60_000;
  const graceMs = Number(opt("grace-minutes", 60 * 24 * 7)) * 60_000;
  const name = opt("name", slug);
  const mine = await L.fetchAll(L.trustedCanariesQuery(pub, slug, w.account.address));
  const seq = mine.reduce((m, e) => Math.max(m, Number(L.attr(e, "seq"))), 0) + 1;
  const now = Date.now();
  const canary = L.canaryCreate({ issuer: slug, seq, statement, issuedAt: now, dueAt: now + dueMs, graceMs });
  // Atomic batch: new canary + keep (or create) the issuer profile alive.
  const profiles = await pub.select({ key: true }).where(L.issuerProfileFilters(slug)).createdBy(w.account.address).fetch();
  const batch = { creates: [canary] };
  if (profiles.entities.length) batch.extensions = [{ entityKey: profiles.entities[0].key, expires: L.issuerProfileExpiry() }];
  else batch.creates.push(L.issuerProfileCreate({ issuer: slug, name, bindingUrl: DEFAULT_BINDING }));
  const res = await w.executeBatch(batch);
  console.log(json({ issued: slug, seq, txHash: res.txHash, canaryKey: res.createdEntities[0], created: res.createdEntities, extended: res.extendedEntities }));
}

async function witness(slug) {
  const w = wallet();
  const b = await binding(slug);
  const all = await L.fetchAll(L.trustedCanariesQuery(pub, slug, b.wallet));
  const r = L.classify({ entities: all, wallet: b.wallet });
  if (!r.latest) throw new Error(`${slug} has no live canary to witness (status ${r.status})`);
  const block = await pub.getBlockNumber();
  const res = await w.createEntity(L.witnessCreate({ issuer: slug, canaryKey: r.latest.key, canarySeq: Number(L.attr(r.latest, "seq")), seenAt: Date.now(), seenBlock: block, note: opt("note", "") }));
  console.log(json({ witnessed: slug, canary: r.latest.key, seenBlock: block, ...res }));
}

async function forge(slug) {
  // Demo only: a different wallet publishes a canary under someone else's issuer slug.
  const w = wallet(); const now = Date.now();
  const res = await w.createEntity(L.canaryCreate({ issuer: slug, seq: 999, statement: `ALL CLEAR (forged by ${w.account.address})`, issuedAt: now, dueAt: now + 30 * 86400e3, graceMs: 86400e3 }));
  console.log(json({ forged: slug, ...res }));
}

function watch() {
  const ws = createPublicClient({ chain: tiramisu, transport: webSocket() });
  const log = (t) => (e) => console.log(json({ event: t, key: e.entityKey, block: e.blockNumber, tx: e.transactionHash, expiresAt: e.expiresAt }));
  ws.watchEntityEvents({ onEntityCreated: log("created"), onExpiryExtended: log("extended"), onEntityDeleted: log("deleted"), onError: (e) => console.error(e.message) });
  console.error("watching Tiramisu entity events over WebSocket (Ctrl-C to stop)");
}

const usage = `lapse <check|issue|witness|forge|watch> <issuer-slug> [--binding url] [--statement s] [--due-minutes n] [--grace-minutes n] [--note s]
exit codes for check: 0 ALIVE, 1 OVERDUE (due passed, in grace), 2 LAPSED, 3 UNKNOWN, 4 FORGED-only`;
const cmds = { check, issue, witness, forge, watch };
if (!cmds[cmd]) { console.log(usage); process.exit(cmd ? 64 : 0); }
try { await cmds[cmd](args[0]); } catch (e) { console.error("error:", e.shortMessage || e.message); process.exit(70); }
