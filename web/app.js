// Lapse web app: static, no backend. Reads the public Tiramisu RPC directly from the browser.
import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket, getAddress } from "viem";
import * as L from "../core/lapse.js";

const EXPLORER = "https://tiramisu.explorer.arkiv.network";
const pub = createPublicClient({ chain: tiramisu, transport: http() });
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "");
const when = (ms) => new Date(Number(ms)).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const lapseKeys = new Set();

function rel(ms) {
  const d = Number(ms) - Date.now(), a = Math.abs(d), m = Math.round(a / 60000);
  const t = m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  return d >= 0 ? `in ${t}` : `${t} ago`;
}

async function renderIssuer(slug, name, wallet, el) {
  el.innerHTML = `<h2 style="margin:0">${esc(name)} <span class="mut" style="font-size:14px">${esc(slug)}</span></h2><div class="mut">loading from Arkiv…</div>`;
  try {
    const [all, witnesses, head] = await Promise.all([
      L.fetchAll(L.allCanariesQuery(pub, slug)),
      L.fetchAll(L.witnessesQuery(pub, slug)),
      pub.getBlockNumber(),
    ]);
    const r = L.classify({ entities: all, wallet });
    [...all, ...witnesses].forEach((e) => lapseKeys.add(e.key.toLowerCase()));
    const latest = r.latest;
    const body = latest?.toJson?.() ?? {};
    const blocksLeft = latest ? Number(latest.expiresAt - head) : 0;
    let html = `<h2 style="margin:0">${esc(name)} <span class="badge ${r.status}">${r.status}</span>${r.forged.length ? ` <span class="badge FORGED">${r.forged.length} FORGED</span>` : ""}</h2>
      <div class="mut">slug <code>${esc(slug)}</code> · bound wallet <a href="${EXPLORER}/address/${wallet}">${short(wallet)}</a> (from <a href="./.well-known/lapse.json">.well-known/lapse.json</a>)</div>`;
    if (latest) {
      html += `<p class="stmt">“${esc(body.statement)}”</p>
      <div>Canary #${esc(L.attr(latest, "seq"))} issued ${when(L.attr(latest, "issued_at"))} · next renewal due <b>${rel(L.attr(latest, "due_at"))}</b> · Entity Expiration at block ${latest.expiresAt} (~${rel(Date.now() + blocksLeft * 2000)}, then it vanishes)</div>
      <div class="mut">entity <a href="${EXPLORER}/search?q=${latest.key}">${short(latest.key)}</a> · read-only, only the issuer can extend</div>`;
    } else {
      html += `<p><b>No live canary from the bound wallet.</b> Either it was never issued or it was not renewed and Arkiv expired it. Silence is the signal.</p>`;
    }
    if (r.trusted.length > 1) {
      html += `<details><summary>History (${r.trusted.length} live canaries)</summary><table><tr><th>#</th><th>issued</th><th>due</th><th>key</th></tr>${r.trusted.map((e) => `<tr><td>${L.attr(e, "seq")}</td><td>${when(L.attr(e, "issued_at"))}</td><td>${when(L.attr(e, "due_at"))}</td><td><code>${short(e.key)}</code></td></tr>`).join("")}</table></details>`;
    }
    if (r.forged.length) {
      html += `<div style="margin-top:8px"><b style="color:var(--forge)">Forgeries rejected:</b> same <code>issuer</code> attribute, wrong <code>$creator</code>. Anyone can write an attribute; nobody can fake a creator.<table>${r.forged.map((e) => `<tr><td><span class="badge FORGED">FORGED</span></td><td>creator <a href="${EXPLORER}/address/${e.creator}">${short(e.creator)}</a></td><td class="stmt">${esc(e.toJson?.().statement)}</td></tr>`).join("")}</table></div>`;
    }
    html += `<div style="margin-top:8px"><b>Witnesses</b> (${witnesses.length}): independent wallets attesting “I saw it alive”. Anyone can extend these, so the record outlives the canary.${witnesses.length ? `<table>${witnesses.map((w) => `<tr><td><a href="${EXPLORER}/address/${w.creator}">${short(w.creator)}</a></td><td>saw #${L.attr(w, "canary_seq")}</td><td>at block ${L.attr(w, "seen_block")}</td><td>${when(L.attr(w, "seen_at"))}</td></tr>`).join("")}</table>` : ""}</div>`;
    html += `<details><summary>Exact Arkiv query</summary><pre>${esc(L.queryText(pub, slug, wallet))}</pre></details>`;
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML += `<div style="color:var(--bad)">query failed: ${esc(e.shortMessage || e.message)}</div>`;
  }
}

async function main() {
  const binding = await (await fetch("./.well-known/lapse.json")).json();
  const box = $("#issuers");
  for (const [slug, v] of Object.entries(binding.issuers)) {
    const el = document.createElement("div"); el.className = "card"; box.append(el);
    renderIssuer(slug, v.name, getAddress(v.wallet), el);
  }
  $("#custom").onsubmit = (ev) => {
    ev.preventDefault();
    const el = document.createElement("div"); el.className = "card"; box.prepend(el);
    try { renderIssuer(L.assertSlug($("#cslug").value.trim()), $("#cslug").value.trim(), getAddress($("#cwallet").value.trim()), el); }
    catch (e) { el.textContent = e.message; }
  };
  startFeed();
}

function startFeed() {
  const feed = $("#feed");
  const add = (type, e) => {
    const mine = lapseKeys.has(e.entityKey.toLowerCase());
    const d = document.createElement("div");
    d.innerHTML = `${mine ? "★ " : ""}<b>${type}</b> ${short(e.entityKey)} · block ${e.blockNumber}${e.expiresAt ? ` · expires ${e.expiresAt}` : ""}`;
    if (mine) d.style.color = "#f0b72f";
    feed.prepend(d); while (feed.children.length > 40) feed.lastChild.remove();
  };
  try {
    const ws = createPublicClient({ chain: tiramisu, transport: webSocket() });
    ws.watchEntityEvents({
      onEntityCreated: (e) => add("created", e),
      onExpiryExtended: (e) => add("extended", e),
      onEntityPatched: (e) => add("patched", e),
      onEntityDeleted: (e) => add("deleted", e),
      onError: (err) => { $("#wsstate").textContent = "(error: " + err.message.slice(0, 60) + ")"; },
    });
    $("#wsstate").textContent = "(connected)";
  } catch (e) { $("#wsstate").textContent = "(unavailable)"; }
}
main();
