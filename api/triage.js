// POST /api/triage — bounty triage scoring (GO / HOLD / NO-GO).
// Pure compute, no data file. Pay-per-call x402, same pattern as api/prices.js.
// Input (JSON body or query): { alerts: [{id,url,rails,paypalOnly,payout_real,machine_submit,age_h,crowded}] }
// Output: ranked [{id,verdict,score,lock_target,scaffold}] + counts.
const YOUR_WALLET = "0x9592d926920D99758fD3394c88f35959af6aD888";
const USDC_BASE = "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913";
const PRICE = "10000";
const FACILITATOR = "https://x402.org/facilitator";
const DESC = "Bounty triage scoring: paste fixer-board alerts, get GO/HOLD/NO-GO rank with lock target (pay-per-call)";
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "X-PAYMENT, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "payment-required, X-PAYMENT-RESPONSE");
}
function pickBody(req) {
  try {
    const b = req.body;
    if (b && typeof b === "object") return b;
    if (typeof b === "string" && b) return JSON.parse(b);
  } catch (e) {}
  return {};
}
function bazaarExt() {
  return { bazaar: {
    info: { name: "Escrow-Bounty Radar /triage", input: { alerts: "array of {id,url,rails,payout_real,machine_submit,age_h}" } },
    schema: { properties: {
      input: { properties: { alerts: { type: "array", required: true, description: "Raw fixer-board alerts" } } },
      output: { properties: { example: { id: "paraloom-core#1329", verdict: "GO", score: 3, lock_target: "https://github.com/x/y/issues/1" } } }
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
function triage(alerts) {
  const out = [];
  for (const a of (Array.isArray(alerts) ? alerts : []).slice(0, 50)) {
    const railsOk = (["solana", "evm", "stripe", "crypto", "base"].includes(String(a.rails || "").toLowerCase())) && !a.paypalOnly;
    const fresh = (a.age_h == null ? true : Number(a.age_h) < 24);
    let score = 0;
    if (a.payout_real) score++;
    if (railsOk) score++;
    if (a.machine_submit) score++;
    if (fresh) score++;
    const verdict = score >= 3 && !a.crowded ? "GO" : (score === 2 ? "HOLD" : "NO-GO");
    out.push({ id: a.id || null, verdict, score,
      lock_target: a.url || null,
      scaffold: verdict === "GO" ? "lock -> repro -> patch -> re-verify x3" : null,
      fetched_at: new Date().toISOString() });
  }
  return out.sort((x, y) => y.score - x.score);
}
export default async function handler(req, res) {
  const url = "https://" + req.headers.host + "/api/triage";
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
    const input = pickBody(req);
    const alerts = Array.isArray(input.alerts) ? input.alerts : (Array.isArray(input) ? input : []);
    if (!alerts.length) { cors(res); return res.status(400).json({ error: "send {alerts:[...]} in JSON body" }); }
    const data = triage(alerts);
    const sr = await fetch(FACILITATOR + "/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const s = await sr.json();
    if (!s || s.success !== true) return needPay(res, url, method);
    cors(res);
    res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(s)).toString("base64"));
    return res.status(200).json({ count: data.length, go: data.filter(d => d.verdict === "GO").length, results: data });
  } catch (e) { return needPay(res, url, method); }
}
