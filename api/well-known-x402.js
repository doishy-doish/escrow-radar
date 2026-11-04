export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({ x402Version: 1, version: 1, name: "Escrow-Bounty Radar",
    description: "Pay-per-call datasets for agents on Base (USDC, no key): bounty board, token prices, gas quotes, AI papers.",
    resources: [
      "https://escrow-radar.vercel.app/api/feed",
      "https://escrow-radar.vercel.app/api/prices",
      "https://escrow-radar.vercel.app/api/gas",
      "https://escrow-radar.vercel.app/api/papers"
    ],
    ownershipProofs: ["0x9592d926920D99758fD3394c88f35959af6aD888"],
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
