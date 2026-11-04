const YOUR_WALLET = "0x9592d926920D99758fD3394c88f35959af6aD888";
const USDC_BASE = "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913";
const PRICE_ATOMIC = "10000";
const FACILITATOR = "https://x402.org/facilitator";
const FEED_URL = "https://raw.githubusercontent.com/doishy-doish/agent-search/runs/results/results.json";
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
    info: { name: "Escrow-Bounty Radar /feed", input: { queryParams: { limit: "10" } } },
    schema: {
      properties: {
        input: { properties: { queryParams: { limit: { type: "string", required: false, description: "Max items to return, e.g. 10" } } } },
        output: { properties: { example: { stream: "bot:bountic-bot", title: "Feature Request: Multiple PR contributors payout distribution", url: "https://github.com/skndash96/bountic/issues/12" } } }
      }
    }
  } };
}
function reqs(url, method) {
  return { scheme: "exact", network: "eip155:8453",
    asset: USDC_BASE, amount: PRICE_ATOMIC,
    payTo: YOUR_WALLET, resource: method + " " + url, mimeType: "application/json",
    maxTimeoutSeconds: 300,
    facilitator: { url: FACILITATOR },
    outputSchema: { input: { type: "http", method: method, discoverable: true } },
    extensions: bazaarExt(),
    extra: { name: "USD Coin", version: "2" } };
}
function needPay(res, url, method) {
  cors(res);
  res.setHeader("Cache-Control", "public, max-age=60");
  const payload = { x402Version: 2, error: "X-PAYMENT header is required", resource: { url, description: "Live escrow-bounty radar feed (pay-per-call dataset)", mimeType: "application/json" }, accepts: [reqs(url, method)], extensions: bazaarExt() };
  res.setHeader("payment-required", Buffer.from(JSON.stringify(payload)).toString("base64"));
  return res.status(402).json(payload);
}
async function getFeed() {
  if (cache.data && Date.now() - cache.at < 300000) return cache.data;
  const r = await fetch(FEED_URL, { headers: { "User-Agent": "x402-radar/1.0" } });
  if (!r.ok) throw new Error("feed " + r.status);
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}
export default async function handler(req, res) {
  const limRaw = pick(req, "limit");
  const lim = Math.max(0, parseInt(limRaw || "0", 10) || 0);
  const url = "https://" + req.headers.host + "/api/feed" + (lim > 0 ? "?limit=" + Math.min(lim, 50) : "");
  const method = req.method === "POST" ? "POST" : "GET";
  if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }
  const pay = req.headers["x-payment"];
  if (!pay) return needPay(res, url, method);
  let payload;
  try { payload = JSON.parse(Buffer.from(pay, "base64").toString("utf8")); }
  catch (e) { return needPay(res, url, method); }
  if (req.method !== "GET" && req.method !== "POST") { cors(res); return res.status(405).json({ error: "GET/POST only" }); }
  payload.x402Version = 2;
  const body = JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: reqs(url, method) });
  try {
    const vr = await fetch(FACILITATOR + "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const v = await vr.json();
    if (!v || v.isValid !== true) return needPay(res, url, method);
    let feed = await getFeed();
    if (!Array.isArray(feed)) feed = feed.items || feed.results || feed.feed || feed.data || [];
    if (lim > 0) feed = feed.slice(0, Math.min(lim, 50));
    const sr = await fetch(FACILITATOR + "/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const s = await sr.json();
    if (!s || s.success !== true) return needPay(res, url, method);
    cors(res);
    res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(s)).toString("base64"));
    return res.status(200).json(feed);
  } catch (e) { return needPay(res, url, method); }
}
