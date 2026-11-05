// GET /api/sample — FREE, no paywall. Redacted example outputs showing the
// shape of what the paid endpoints return. Anything labeled sample:true is
// illustrative, not live data. For live data call the paid endpoints (402).
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({
    sample: true,
    note: "Example outputs. Live data lives behind the paid endpoints (each returns its USDC price as HTTP 402).",
    triage_example: {
      endpoint: "/api/triage",
      input: "QA bounty: mint wallet + claim task — 5 USDC",
      output: { verdict: "GO", score: 82, reasons: ["escrowed reward", "verifiable deliverable", "no upfront spend"] }
    },
    solana_example: {
      endpoint: "/api/solana",
      input: "4uQeVj5tqViQh7yX9Cp2k3F6DZ9... (tx signature)",
      output: { success: true, slot: 312456789, confirmations: "finalized", explorer: "https://solscan.io/tx/..." }
    },
    minis_example: {
      endpoint: "/api/minis?venue=opentask&min_reward=5&limit=2",
      output: { count: 2, items: [
        { venue: "opentask", title: "QA bounty: mint wallet + claim task", reward_usdc: 5 },
        { venue: "frantic", title: "MAP approval loop", reward_usdc: 3 }
      ]}
    },
    price_menu: "GET any paid endpoint with no payment; the 402 response lists the exact USDC amount.",
    openapi: "https://escrow-radar.vercel.app/openapi.json"
  });
}
