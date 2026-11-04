// GET /api/tick?key=SHARED — relay: fires the agent-search radar dispatch.
// Keyless for the caller (cron-job.org holds only the URL); the GitHub token
// stays in Vercel env (GH_DISPATCH_TOKEN), never in code, never to third
// parties. The key is a 256-bit random shared with the operator only.
const OWNER = "doishy-doish";
const REPO = "agent-search";
const WORKFLOW = "search.yml";
const TARGET = "bountic-bot,bountyhub-app,opire,algora-io,gitwork-io";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  let key = null;
  try {
    if (req.query && req.query.key) key = req.query.key;
    else key = new URL(req.url, "https://x").searchParams.get("key");
  } catch { key = null; }
  if (!process.env.TICK_KEY || key !== process.env.TICK_KEY) {
    res.status(403).json({ error: "bad key" });
    return;
  }
  const gh = process.env.GH_DISPATCH_TOKEN;
  if (!gh) { res.status(500).json({ error: "no token configured" }); return; }
  let r;
  try {
    r = await fetch(
      "https://api.github.com/repos/" + OWNER + "/" + REPO + "/actions/workflows/" + WORKFLOW + "/dispatches",
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + gh,
          "Content-Type": "application/json",
          "User-Agent": "escrow-radar-tick",
        },
        body: JSON.stringify({ ref: "main", inputs: { stream: "bot", target: TARGET, limit: "10" } }),
      }
    );
  } catch (e) {
    res.status(502).json({ ok: false, error: "github unreachable" });
    return;
  }
  if (r.status === 204) { res.status(200).json({ ok: true, dispatched: true }); return; }
  let t = "";
  try { t = await r.text(); } catch { t = ""; }
  res.status(502).json({ ok: false, github: r.status, preview: String(t).slice(0, 200) });
}
