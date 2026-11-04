const YOUR_WALLET = "0x9592d926920D99758fD3394c88f35959af6aD888";
const USDC_BASE = "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913";
const PRICE_BULK = "10000";
const PRICE_ONE = "5000";
const FACILITATOR = "https://x402.org/facilitator";
const DATA_URL = "https://raw.githubusercontent.com/doishy-doish/escrow-radar/main/data/bounties.json";
const DESC = "Verified GitHub bounty feed: competing-PR counts, CI status, repro commands (pay-per-call dataset)";
let cache = { at: 0, data: null };
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "X-PAYMENT, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "payment-required, X-PAYMENT-RESPONSE");
}
function pick(req, name) {
  try {
    if (req.query && req.query[name] != null && String(req.query[name]) !== "") return String(req.query[name]);
  } catch (e) {}
  try {
    const b = req.body;
    if (b && typeof b === "object" && b[name] != null && String(b[name]) !== "") return String(b[name]);
    if (typeof b === "string" && b) {
      const j = JSON.parse(b);
      if (j && j[name] != null && String(j[name]) !== "") return String(j[name]);
    }
  } catch (e) {}
  return "";
}
function bazaarExt() {
  return { bazaar: {
    info: { name: "Escrow-Bounty Radar /bounties", input: { queryParams: { uncontested: "1", min_reward: "100" } } },
    schema: {
      properties: {
        input: { properties: { queryParams: {
          id: { type: "string", required: false, description: "One record id, e.g. paraloom-core#1329" },
          uncontested: { type: "string", required: false, description: "1 = only issues with zero competing PRs" },
          min_reward: { type: "string", required: false, description: "Minimum reward_usdc, e.g. 100" },
          severity: { type: "string", required: false, description: "Low, Medium, High or Critical" },
          limit: { type: "string", required: false, description: "Max items to return, e.g. 10" }
        } } },
        output: { properties: { example: {
          id: "paraloom-core#1329", venue: "paraloom", repo: "paraloom-core", number: 1329,
          title: "[BUG BOUNTY] Low: GET /transact/scan serves the node's full delivered-note feed",
          url: "https://github.com/paraloom-labs/paraloom-core/issues/1329",
          severity: "Low", reward_usdc: 50, reward_source: "severity_table",
          age_seconds_since_open: 42000, competing_prs: 1, ci_status: "passing",
          repro_command: "cargo test", rail: "MANUAL_MAINTAINER_REVIEW", escrow_verified: false,
          failing_assertion: "assert_eq!(balance, expected)", target_files: ["src/ledger/state.rs"], stack_excerpt: null,
          claimed_in_comments: false, claim_evidence: null
        } } }
      }
    }
  } };
}
function reqs(url, method, single) {
  return { scheme: "exact", network: "eip155:8453",
    asset: USDC_BASE, amount: single ? PRICE_ONE : PRICE_BULK,
    payTo: YOUR_WALLET, resource: method + " " + url, mimeType: "application/json",
    maxTimeoutSeconds: 300,
    facilitator: { url: FACILITATOR },
    outputSchema: { input: { type: "http", method: method, discoverable: true } },
    extensions: bazaarExt(),
    extra: { name: "USD Coin", version: "2" } };
}
function needPay(res, url, method, single) {
  cors(res);
  res.setHeader("Cache-Control", "public, max-age=60");
  const payload = { x402Version: 2, error: "X-PAYMENT header is required", resource: { url, description: DESC, mimeType: "application/json" }, accepts: [reqs(url, method, single)], extensions: bazaarExt() };
  res.setHeader("payment-required", Buffer.from(JSON.stringify(payload)).toString("base64"));
  return res.status(402).json(payload);
}
async function getData() {
  if (cache.data && Date.now() - cache.at < 300000) return cache.data;
  const r = await fetch(DATA_URL, { headers: { "User-Agent": "x402-radar/1.0" } });
  if (!r.ok) throw new Error("bounties " + r.status);
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}
export default async function handler(req, res) {
  const idRaw = pick(req, "id");
  const uncRaw = pick(req, "uncontested");
  const minRaw = pick(req, "min_reward");
  const sevRaw = pick(req, "severity");
  const limRaw = pick(req, "limit");
  const lim = Math.max(0, parseInt(limRaw || "0", 10) || 0);
  const minR = parseFloat(minRaw || "0") || 0;
  const unc = uncRaw === "1" || uncRaw.toLowerCase() === "true";
  const sev = sevRaw ? String(sevRaw).toLowerCase() : "";
  const qid = idRaw ? String(idRaw) : "";
  const qs = [];
  if (qid) qs.push("id=" + encodeURIComponent(qid));
  if (unc) qs.push("uncontested=1");
  if (minR > 0) qs.push("min_reward=" + minR);
  if (sev) qs.push("severity=" + encodeURIComponent(sevRaw));
  if (lim > 0) qs.push("limit=" + Math.min(lim, 50));
  const filtered = !!(qid || unc || minR > 0 || sev || lim > 0);
  const url = "https://" + req.headers.host + "/api/bounties" + (qs.length ? "?" + qs.join("&") : "");
  const method = req.method === "POST" ? "POST" : "GET";
  if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }
  const pay = req.headers["x-payment"];
  if (!pay) return needPay(res, url, method, filtered);
  let payload;
  try { payload = JSON.parse(Buffer.from(pay, "base64").toString("utf8")); }
  catch (e) { return needPay(res, url, method, filtered); }
  if (req.method !== "GET" && req.method !== "POST") { cors(res); return res.status(405).json({ error: "GET/POST only" }); }
  payload.x402Version = 2;
  const body = JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: reqs(url, method, filtered) });
  try {
    const vr = await fetch(FACILITATOR + "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const v = await vr.json();
    if (!v || v.isValid !== true) return needPay(res, url, method, filtered);
    let data = await getData();
    if (!Array.isArray(data)) data = [];
    if (qid) data = data.filter(p => p.id === qid || String(p.number) === qid);
    if (unc) data = data.filter(p => p.competing_prs === 0);
    if (minR > 0) data = data.filter(p => (p.reward_usdc || 0) >= minR);
    if (sev) data = data.filter(p => String(p.severity || "").toLowerCase() === sev);
    if (qid && !data.length) { cors(res); return res.status(404).json({ error: "unknown id" }); }
    if (lim > 0) data = data.slice(0, Math.min(lim, 50));
    const sr = await fetch(FACILITATOR + "/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const s = await sr.json();
    if (!s || s.success !== true) return needPay(res, url, method, filtered);
    cors(res);
    res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(s)).toString("base64"));
    return res.status(200).json(data);
  } catch (e) { return needPay(res, url, method, filtered); }
}
