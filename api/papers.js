// GET /api/papers[?id=...] — normalized arXiv papers feed.
// Same x402-v1 paywall pattern as api/feed.js. Data: data/papers.json in this
// repo (harvested by harvest-papers.mjs from Actions; arXiv is unreachable
// from browser/proxy paths). Empty array until the first harvest lands.
const YOUR_WALLET = "0x9592d926920D99758fD3394c88f35959af6aD888";
const USDC_BASE = "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913";
const PRICE_BULK = "10000";
const PRICE_ONE = "5000";
const FACILITATOR = "https://x402.org/facilitator";
const DATA_URL = "https://raw.githubusercontent.com/doishy-doish/escrow-radar/main/data/papers.json";
let cache = { at: 0, data: null };
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "X-PAYMENT, Content-Type");
}
function reqs(url, single) {
  return { scheme: "exact", network: "eip155:8453",
    asset: USDC_BASE, amount: single ? PRICE_ONE : PRICE_BULK,
    payTo: YOUR_WALLET, resource: "GET " + url, mimeType: "application/json",
    maxTimeoutSeconds: 300,
    facilitator: { url: FACILITATOR },
    outputSchema: { input: { type: "http", method: "GET", discoverable: true } },
    extra: { name: "USD Coin", version: "2" } };
}
function needPay(res, url, single) {
  cors(res);
  res.setHeader("Cache-Control", "public, max-age=60");
  return res.status(402).json({ x402Version: 2, error: "X-PAYMENT header is required", accepts: [reqs(url, single)] });
}
async function getData() {
  if (cache.data && Date.now() - cache.at < 900000) return cache.data;
  const r = await fetch(DATA_URL, { headers: { "User-Agent": "x402-radar/1.0" } });
  if (!r.ok) throw new Error("papers " + r.status);
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}
export default async function handler(req, res) {
  const q = req.query && req.query.id ? String(req.query.id) : "";
  const url = "https://" + req.headers.host + "/api/papers" + (q ? "?id=" + encodeURIComponent(q) : "");
  if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }
  if (req.method !== "GET") { cors(res); return res.status(405).json({ error: "GET only" }); }
  const pay = req.headers["x-payment"];
  if (!pay) return needPay(res, url, !!q);
  let payload;
  try { payload = JSON.parse(Buffer.from(pay, "base64").toString("utf8")); }
  catch (e) { return needPay(res, url, !!q); }
  payload.x402Version = 2;
  const body = JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: reqs(url, !!q) });
  try {
    const vr = await fetch(FACILITATOR + "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const v = await vr.json();
    if (!v || v.isValid !== true) return needPay(res, url, !!q);
    let data = await getData();
    if (q) {
      data = data.filter(p => p.id === q);
      if (!data.length) { cors(res); return res.status(404).json({ error: "unknown id" }); }
    }
    const sr = await fetch(FACILITATOR + "/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const s = await sr.json();
    if (!s || s.success !== true) return needPay(res, url, !!q);
    cors(res);
    res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(s)).toString("base64"));
    return res.status(200).json(data);
  } catch (e) { return needPay(res, url, !!q); }
}
