import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import * as L from "../core/lapse.js";

const A = "0x2e6C27eE29865110beb601175bF628b1230F4eF1";
const B = "0xD90DAD33Afc160728b05400703c5Db0436ac1B3c";
const ent = (creator, seq, dueAt) => ({ key: "0x" + String(seq).padStart(64, "0"), creator, attributes: { seq: { type: "u64", value: BigInt(seq) }, due_at: { type: "u64", value: BigInt(dueAt) } } });

test("canary is read-only, owner-only extension, typed attributes", () => {
  const c = L.canaryCreate({ issuer: "example-vpn", seq: 3, statement: "all clear", issuedAt: 1000, dueAt: 2000, graceMs: 500 });
  assert.deepEqual(c.flags, { readonly: true, permissionlessExtension: false });
  assert.equal(c.attributes.type.value, "canary");
  assert.equal(c.attributes.due_at.type, "u64");
  assert.equal(c.attributes.statement_hash.value, L.statementHash("all clear"));
  const body = JSON.parse(new TextDecoder().decode(c.payload));
  assert.equal(body.statement, "all clear");
});

test("witness can be extended by anyone", () => {
  const w = L.witnessCreate({ issuer: "example-vpn", canaryKey: "0x" + "ab".repeat(32), canarySeq: 1, seenAt: 1, seenBlock: 5n });
  assert.deepEqual(w.flags, { readonly: true, permissionlessExtension: true });
});

test("rejects bad input", () => {
  assert.throws(() => L.assertSlug("Bad Slug"));
  assert.throws(() => L.canaryCreate({ issuer: "x", seq: 1, statement: "s", issuedAt: 5, dueAt: 5, graceMs: 0 }));
  assert.throws(() => L.canaryCreate({ issuer: "x", seq: 1, statement: "s".repeat(L.MAX_STATEMENT_BYTES + 1), issuedAt: 1, dueAt: 5, graceMs: 0 }));
});

test("classify: alive, overdue, lapsed, forged", () => {
  const now = 10_000;
  assert.equal(L.classify({ entities: [ent(A, 1, 5000), ent(A, 2, 20000)], wallet: A, now }).status, "ALIVE");
  assert.equal(L.classify({ entities: [ent(A, 1, 5000)], wallet: A, now }).status, "OVERDUE");
  const f = L.classify({ entities: [ent(B, 999, 99999)], wallet: A, now });
  assert.equal(f.status, "LAPSED");          // a forged canary never keeps an issuer alive
  assert.equal(f.forged.length, 1);
  assert.equal(L.classify({ entities: [], wallet: null, now }).status, "UNKNOWN");
});

test("binding parse", () => {
  assert.equal(L.parseBinding({ issuers: { x: { wallet: A.toLowerCase() } } }, "x").wallet, A);
  assert.equal(L.parseBinding({ issuers: {} }, "x"), null);
});

test("trusted query filters on $creator, not a writable attribute", () => {
  const c = createPublicClient({ chain: tiramisu, transport: http() });
  const q = L.queryText(c, "example-vpn", A);
  assert.match(q, /\$creator = addr\(0x2e6C27eE29865110beb601175bF628b1230F4eF1\)/);
  assert.match(q, /type = str\('canary'\)/);
});
