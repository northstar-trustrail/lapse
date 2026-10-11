// Lapse core: schema constants, entity builders, query builders and status logic.
// Shared by the CLI (Node) and the static web app (bundled with esbuild).
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk";
import { str, u64, key, bytes32 } from "@arkiv-network/sdk/attr";
import { eq, gt } from "@arkiv-network/sdk/query";
import { sha256, toHex, stringToBytes, getAddress } from "viem";

export const PROJECT = "lapse-v1";
export const TYPES = { issuer: "issuer", canary: "canary", witness: "witness" };
export const ISSUER_PROFILE_LIFETIME_DAYS = 90;
export const WITNESS_LIFETIME_DAYS = 180;
export const MAX_STATEMENT_BYTES = 16 * 1024;

const SLUG = /^[a-z0-9][a-z0-9.-]{0,63}$/;
export function assertSlug(slug) {
  if (!SLUG.test(slug)) throw new Error(`invalid issuer slug: ${slug}`);
  return slug;
}

export function statementHash(text) {
  return sha256(stringToBytes(text));
}

/** Build the create-params for a canary. Expiry = dueAt + grace, read-only, owner-only extension. */
export function canaryCreate({ issuer, seq, statement, issuedAt, dueAt, graceMs }) {
  assertSlug(issuer);
  if (!(dueAt > issuedAt)) throw new Error("dueAt must be after issuedAt");
  if (stringToBytes(statement).length > MAX_STATEMENT_BYTES) throw new Error("statement too long");
  const hash = statementHash(statement);
  return {
    payload: jsonToPayload({ v: 1, issuer, seq, statement, statementHash: hash, issuedAt, dueAt, graceMs }),
    contentType: "application/json",
    attributes: {
      project: str(PROJECT),
      type: str(TYPES.canary),
      issuer: str(issuer),
      seq: u64(BigInt(seq)),
      issued_at: u64(BigInt(issuedAt)),
      due_at: u64(BigInt(dueAt)),
      statement_hash: bytes32(hash),
    },
    // Exact deadline: the canary dies at due+grace whenever the tx lands, with a 60 s floor.
    expires: ExpirationTime.atDate(new Date(dueAt + graceMs), { atLeast: ExpirationTime.fromSeconds(60) }),
    flags: { readonly: true, permissionlessExtension: false },
  };
}

export function issuerProfileCreate({ issuer, name, bindingUrl }) {
  assertSlug(issuer);
  return {
    payload: jsonToPayload({ v: 1, issuer, name, bindingUrl }),
    contentType: "application/json",
    attributes: { project: str(PROJECT), type: str(TYPES.issuer), issuer: str(issuer) },
    expires: ExpirationTime.fromDays(ISSUER_PROFILE_LIFETIME_DAYS),
    flags: { readonly: true, permissionlessExtension: false },
  };
}

export function witnessCreate({ issuer, canaryKey, canarySeq, seenAt, seenBlock, note = "" }) {
  assertSlug(issuer);
  return {
    payload: jsonToPayload({ v: 1, issuer, canaryKey, canarySeq, seenAt, seenBlock: String(seenBlock), note }),
    contentType: "application/json",
    attributes: {
      project: str(PROJECT),
      type: str(TYPES.witness),
      issuer: str(issuer),
      canary: key(canaryKey),
      canary_seq: u64(BigInt(canarySeq)),
      seen_at: u64(BigInt(seenAt)),
      seen_block: u64(BigInt(seenBlock)),
    },
    expires: ExpirationTime.fromDays(WITNESS_LIFETIME_DAYS),
    // Anyone may keep evidence alive after the canary itself lapses; nobody can edit it.
    flags: { readonly: true, permissionlessExtension: true },
  };
}

// ---------- queries ----------
const FIELDS = { key: true, attributes: true, payload: true, creator: true, owner: true, expiresAt: true, createdAt: true };

/** Trusted canaries: only those created by the wallet bound to the issuer's domain. */
export function trustedCanariesQuery(client, issuer, wallet) {
  return client.select(FIELDS)
    .where(eq("project", str(PROJECT)), eq("type", str(TYPES.canary)), eq("issuer", str(issuer)))
    .createdBy(getAddress(wallet)).limit(200);
}

/** Everything claiming to be this issuer, any creator. Used to surface forgeries. */
export function allCanariesQuery(client, issuer) {
  return client.select(FIELDS)
    .where(eq("project", str(PROJECT)), eq("type", str(TYPES.canary)), eq("issuer", str(issuer))).limit(200);
}

export function notYetDueQuery(client, issuer, wallet, now = Date.now()) {
  return trustedCanariesQuery(client, issuer, wallet).where(gt("due_at", u64(BigInt(now))));
}

export function witnessesQuery(client, issuer) {
  return client.select(FIELDS)
    .where(eq("project", str(PROJECT)), eq("type", str(TYPES.witness)), eq("issuer", str(issuer))).limit(200);
}

/** The exact query text the node parses (printed in the UI's "verify yourself" panel). */
export function queryText(client, issuer, wallet) {
  return trustedCanariesQuery(client, issuer, wallet).toString();
}

export async function fetchAll(builder) {
  const out = [];
  let page = await builder.fetch();
  out.push(...page.entities);
  while (page.hasNextPage && page.hasNextPage()) { page = await page.next(); out.push(...page.entities); }
  return out;
}

// ---------- status ----------
export function attr(e, name) {
  const a = e.attributes?.[name];
  if (a === undefined) return undefined;
  return a && typeof a === "object" && "value" in a ? a.value : a;
}
function num(v) { return v === undefined ? undefined : Number(v); }

/**
 * Classify an issuer. `entities` = every live canary with this issuer slug (any creator).
 * Returns { status: ALIVE|OVERDUE|LAPSED|UNKNOWN, latest, forged[] }.
 */
export function classify({ entities, wallet, now = Date.now() }) {
  const bound = wallet ? getAddress(wallet) : null;
  const trusted = [], forged = [];
  for (const e of entities) {
    if (bound && e.creator && getAddress(e.creator) === bound) trusted.push(e); else forged.push(e);
  }
  if (!bound) return { status: "UNKNOWN", latest: null, trusted, forged };
  trusted.sort((a, b) => num(attr(b, "seq")) - num(attr(a, "seq")));
  const latest = trusted[0] || null;
  if (!latest) return { status: "LAPSED", latest, trusted, forged };
  const due = num(attr(latest, "due_at"));
  return { status: due > now ? "ALIVE" : "OVERDUE", latest, trusted, forged };
}

export const EXIT = { ALIVE: 0, OVERDUE: 1, LAPSED: 2, UNKNOWN: 3, FORGED: 4 };

/** Domain binding: https://<host>/.well-known/lapse.json (or any URL) => { issuers: { slug: { wallet, name } } } */
export function parseBinding(json, slug) {
  const ent = json?.issuers?.[slug];
  if (!ent || !ent.wallet) return null;
  return { slug, wallet: getAddress(ent.wallet), name: ent.name || slug };
}
export { toHex };

export function issuerProfileFilters(issuer) {
  return [eq("project", str(PROJECT)), eq("type", str(TYPES.issuer)), eq("issuer", str(issuer))];
}
export function issuerProfileExpiry() { return ExpirationTime.fromDays(ISSUER_PROFILE_LIFETIME_DAYS); }
