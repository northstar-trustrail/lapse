// Claims test GLM from the Arkiv Hub faucet for a headless wallet. LAPSE_WALLETS=/path/outside/repo.json node demo/faucet/claim.mjs issuer
// Needs playwright-core and a Chrome at /usr/bin/google-chrome. See arkiv/friction.md #1.
// Full faucet claim without a wallet extension:
// 1) SIWE sign-in to Arkiv Hub with the wallet key (Node), 2) run the official Cap proof-of-work widget in headless Chrome
// to get a captcha token, 3) POST /api/faucet with the session cookie. usage: node claim3.mjs <role>
import fs from "fs"; import http from "http"; import { chromium } from "playwright-core";
import { privateKeyToAccount } from "viem/accounts"; import { createSiweMessage } from "viem/siwe";
const role = process.argv[2] || "issuer";
const W = JSON.parse(fs.readFileSync(process.env.LAPSE_WALLETS));
const acct = privateKeyToAccount(W[role].privateKey);
const H = "https://hub.arkiv.network", chainId = 7738577;
const cookies = {};
const jar = (r) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); cookies[kv.slice(0, i)] = kv.slice(i + 1); } };
const ck = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
const req = async (p, body) => { const r = await fetch(H + p, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", origin: H, cookie: ck() }, body: body && JSON.stringify(body) }); jar(r); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : {} }; };
const { body: { nonce } } = await req("/api/auth/siwe/nonce", { walletAddress: acct.address, chainId });
const message = createSiweMessage({ domain: "hub.arkiv.network", address: acct.address, statement: "Sign in to Arkiv Hub.", uri: H, version: "1", chainId, nonce });
const v = await req("/api/auth/siwe/verify", { message, signature: await acct.signMessage({ message }), walletAddress: acct.address, chainId });
console.log(role, acct.address, "siwe", v.status, v.body.success);
const info = (await req(`/api/faucet?recipient=${acct.address}`)).body;
console.log("info", JSON.stringify(info));
if (info.cooldownUntil) { console.log("in cooldown"); process.exit(2); }
const srv = http.createServer((q, s) => { s.setHeader("content-type", "text/html"); s.end(`<script src="https://cdn.jsdelivr.net/npm/@cap.js/widget"></script><cap-widget id=w data-cap-api-endpoint="${info.captchaEndpoint}"></cap-widget>`); }).listen(18802);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage();
p.on("requestfailed", (r) => console.log("reqfail", r.url().slice(0, 100), r.failure()?.errorText));
await p.route("https://hub.arkiv.network/__cap", (r) => r.fulfill({ contentType: "text/html", body: `<script src="https://cdn.jsdelivr.net/npm/@cap.js/widget"></script><cap-widget id=w data-cap-api-endpoint="${info.captchaEndpoint}"></cap-widget>` }));
await p.goto("https://hub.arkiv.network/__cap", { waitUntil: "networkidle" });
const token = await p.evaluate(() => new Promise((res, rej) => { const w = document.getElementById("w"); w.addEventListener("solve", (e) => res(e.detail.token)); w.addEventListener("error", (e) => rej(new Error(JSON.stringify(e.detail)))); w.solve(); setTimeout(() => rej(new Error("timeout")), 120000); }));
await b.close(); srv.close();
console.log("captcha solved", !!token);
const c = await req("/api/faucet", { recipient: acct.address, captchaToken: token });
console.log("CLAIM", c.status, JSON.stringify(c.body).slice(0, 500));
