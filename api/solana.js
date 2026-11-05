// GET /api/solana?signature=<base58> — Solana transfer verification.
// Live public RPC, no data file. Pay-per-call x402, same pattern as api/prices.js.
// Output: {signature, slot, success, explorer} + memo.
const YOUR_WALLET = "0x9592d926920D99758fD3394c88f35959af6aD888";
const USDC_BASE = "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913";
const PRICE = "5000";
const FACILITATOR = "https://x402.org/facilitator";
const RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
const DESC = "Solana transfer verification: paste a tx signature, get slot + success + explorer link (pay-per-call)";
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
    info: { name: "Escrow-Bounty Radar /solana", input: { queryParams: { signature: "solana tx signature" } } },
    schema: { properties: {
      input: { properties: { queryParams: { signature: { type: "string", required: true, description: "Solana transaction signature" } } } },
      output: { properties: { example: { signature: "5x...", slot: 123456789, success: true, explorer: "https://explorer.solana.com/tx/5x..." } } }
    } }
  } };
}
function reqs(url, method) {
  return { scheme: "exact", network: "eip155:8453",
    asset: USDC_BASE, amount: PRICE,
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
  const payload = { x402Version: 2, error: "X-PAYMENT header is required", resource: { url, description: DESC, mimeType: "application/json" }, accepts: [reqs(url, method)], extensions: bazaarExt() };
  res.setHeader("payment-required", Buffer.from(JSON.stringify(payload)).toString("base64"));
  return res.status(402).json(payload);
}
async function lookup(sig) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", maxSupportedTransactionVersion: 0 }] });
  let lastErr = null;
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "x402-radar/1.0" }, body });
      const j = await r.json();
      if (j && j.result) return { signature: sig, slot: j.result.slot ?? null, success: (j.result.meta && j.result.meta.err == null), explorer: "https://explorer.solana.com/tx/" + sig };
      if (j && j.error) { lastErr = j.error.message || "not found"; continue; }
      return { signature: sig, slot: null, success: false, explorer: "https://explorer.solana.com/tx/" + sig, note: "no result yet — try again in 30s" };
    } catch (e) { lastErr = String(e).slice(0, 80); }
  }
  return { signature: sig, slot: null, success: false, explorer: "https://explorer.solana.com/tx/" + sig, error: lastErr || "lookup failed" };
}
export default async function handler(req, res) {
  const sig = pick(req, "signature").trim();
  const url = "https://" + req.headers.host + "/api/solana" + (sig ? "?signature=" + encodeURIComponent(sig.slice(0, 20) + "...") : "");
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
    if (!sig || sig.length < 32) { cors(res); return res.status(400).json({ error: "send ?signature=<solana tx signature>" }); }
    const data = await lookup(sig);
    const sr = await fetch(FACILITATOR + "/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const s = await sr.json();
    if (!s || s.success !== true) return needPay(res, url, method);
    cors(res);
    res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(s)).toString("base64"));
    return res.status(200).json(data);
  } catch (e) { return needPay(res, url, method); }
}
