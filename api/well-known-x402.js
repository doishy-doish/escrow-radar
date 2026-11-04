export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({ x402Version: 1, name: "Escrow-Bounty Radar",
    description: "Live feed of open software bounties with escrow signals. Refreshed every 15 minutes.",
    routes: [{ path: "/api/feed", price: "0.01 USDC", network: "base", asset: "USDC" }],
    payTo: "0x9592d926920D99758fD3394c88f35959af6aD888" });
}
