// GET /api/minis[?venue=opentask&min_reward=5&limit=10] — aggregated mini-bounty board.
// Sources: Opentask public tasks + Frantic open bounties + Nonsynthetic open tasks.
// Data: data/minis.json (harvester refreshes every 5 min). Pay-per-call x402.
const YOUR_WALLET = "0x9592d926920D99758fD3394c88f35959af6aD888";
const USDC_BASE = "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913";
const PRICE_BULK = "10000";
const PRICE_ONE = "5000";
const FACILITATOR = "https://x402.org/facilitator";
const DATA_URL = "https://raw.githubusercontent.com/doishy-doish/escrow-radar/main/data/minis.json";
const DESC = "Aggregated mini-bounty board: open Opentask + Frantic + Nonsynthetic tasks with rewards (pay-per-call dataset)";
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
    info: { name: "Escrow-Bounty Radar /minis", input: { queryParams: { venue: "opentask", min_reward: "5" } } },
    schema: { properties: {
      input: { properties: { queryParams: {
        venue: { type: "string", required: false, description: "opentask, frantic, or nonsynthetic" },
        min_reward: { type: "string", required: false, description: "Minimum reward_usdc, e.g. 5" },
        limit: { type: "string", required: false, description: "Max items, e.g. 10" }
      } } },
      output: { properties: { example: { venue: "opentask", id: "opentask-abc", title: "QA bounty", url: "https://opentask.ai/tasks/abc", reward_usdc: 5 } } }
    } }
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
  if (!r.ok) throw new Error("minis " + r.status);
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}
export default async function handler(req, res) {
  const venue = pick(req, "venue").toLowerCase();
  const minR = parseFloat(pick(req, "min_reward") || "0") || 0;
  const lim = Math.max(0, parseInt(pick(req, "limit") || "0", 10) || 0);
  const qs = [];
  if (venue) qs.push("venue=" + encodeURIComponent(venue));
  if (minR > 0) qs.push("min_reward=" + minR);
  if (lim > 0) qs.push("limit=" + Math.min(lim, 50));
  const filtered = !!(venue || minR > 0 || lim > 0);
  const url = "https://" + req.headers.host + "/api/minis" + (qs.length ? "?" + qs.join("&") : "");
  const method = req.method === "POST" ? "POST" : "GET";
  if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }
  // Free teaser: first 3 rows, no payment (freemium funnel into the paid board).
  if (!pay && lim > 0 && lim <= 3) {
    try {
      let data = await getData();
      if (!Array.isArray(data)) data = [];
      if (venue) data = data.filter(p => p.venue === venue);
      if (minR > 0) data = data.filter(p => (p.reward_usdc || 0) >= minR);
      cors(res);
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(200).json({ free_teaser: true, note: "First 3 rows free; full board via paid call (price in the 402).", count: Math.min(data.length, 3), items: data.slice(0, 3) });
    } catch (e) { return needPay(res, url, method, filtered); }
  }
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
    if (venue) data = data.filter(p => p.venue === venue);
    if (minR > 0) data = data.filter(p => (p.reward_usdc || 0) >= minR);
    if (lim > 0) data = data.slice(0, Math.min(lim, 50));
    const sr = await fetch(FACILITATOR + "/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const s = await sr.json();
    if (!s || s.success !== true) return needPay(res, url, method, filtered);
    cors(res);
    res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(s)).toString("base64"));
    return res.status(200).json(data);
  } catch (e) { return needPay(res, url, method, filtered); }
}
