export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({ x402Version: 1, name: "Escrow-Bounty Radar",
    description: "Machine-readable datasets for agents: bounty board, bulk token prices, gas quotes, AI papers. Pay per call in USDC on Base.",
    routes: [
      { path: "/api/feed", price: "0.01 USDC", network: "base", asset: "USDC" },
      { path: "/api/prices", price: "0.01 USDC", network: "base", asset: "USDC" },
      { path: "/api/prices?symbol=<symbol>", price: "0.005 USDC", network: "base", asset: "USDC" },
      { path: "/api/gas", price: "0.01 USDC", network: "base", asset: "USDC" },
      { path: "/api/gas?chain=<chain>", price: "0.005 USDC", network: "base", asset: "USDC" },
      { path: "/api/papers", price: "0.01 USDC", network: "base", asset: "USDC" },
      { path: "/api/papers?id=<id>", price: "0.005 USDC", network: "base", asset: "USDC" }
    ],
    payTo: "0x9592d926920D99758fD3394c88f35959af6aD888" });
}
