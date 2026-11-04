const YOUR_WALLET = "0x9592d926920D99758fD3394c88f35959af6aD888";
const USDC_BASE = "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913";
const PRICE_ATOMIC = "10000";
const FACILITATOR = "https://x402.org/facilitator";
const FEED_URL = "https://raw.githubusercontent.com/doishy-doish/agent-search/runs/results/results.json";
let cache = { at: 0, data: null };
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "X-PAYMENT, Content-Type");
}
function reqs(url) {
  return { scheme: "exact", network: "eip155:8453",
    asset: USDC_BASE, amount: PRICE_ATOMIC,
    payTo: YOUR_WALLET, resource: "GET " + url, mimeType: "application/json",
    maxTimeoutSeconds: 300,
    facilitator: { url: FACILITATOR },
    outputSchema: { input: { type: "http", method: "GET", discoverable: true } },
    extensions: {
      bazaar: {
        info: { name: "Escrow-Bounty Radar /feed" },
        schema: {
          properties: {
            input: { properties: { queryParams: {} } },
            output: { properties: { example: { slug: "paraloom", title: "check_bearer scan gate", payout: "50" } } }
          }
        }
      }
    },
    extra: { name: "USD Coin", version: "2" } };
}
function needPay(res, url) {
  cors(res);
  res.setHeader("Cache-Control", "public, max-age=60");
  return res.status(402).json({ x402Version: 2, error: "X-PAYMENT header is required", accepts: [reqs(url)] });
}
async function getFeed() {
  if (cache.data && Date.now() - cache.at < 300000) return cache.data;
  const r = await fetch(FEED_URL, { headers: { "User-Agent": "x402-radar/1.0" } });
  if (!r.ok) throw new Error("feed " + r.status);
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}
export default async function handler(req, res) {
  const url = "https://" + req.headers.host + "/api/feed";
  if (req.method === "OPTIONS") { cors(res); return res.status(204).end(); }
  const pay = req.headers["x-payment"];
  if (!pay) return needPay(res, url);
  let payload;
  try { payload = JSON.parse(Buffer.from(pay, "base64").toString("utf8")); }
  catch (e) { return needPay(res, url); }
  if (req.method !== "GET") { cors(res); return res.status(405).json({ error: "GET only" }); }
  payload.x402Version = 2;
  const body = JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: reqs(url) });
  try {
    const vr = await fetch(FACILITATOR + "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const v = await vr.json();
    if (!v || v.isValid !== true) return needPay(res, url);
    const feed = await getFeed();
    const sr = await fetch(FACILITATOR + "/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const s = await sr.json();
    if (!s || s.success !== true) return needPay(res, url);
    cors(res);
    res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(s)).toString("base64"));
    return res.status(200).json(feed);
  } catch (e) { return needPay(res, url); }
}
