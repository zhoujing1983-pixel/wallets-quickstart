import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";

const RPCS = [
  { name: "devnet", url: "https://api.devnet.solana.com" },
  { name: "testnet", url: "https://api.testnet.solana.com" },
  { name: "mainnet-beta", url: "https://api.mainnet-beta.solana.com" },
];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const signature = typeof body?.signature === "string" ? body.signature : "";

  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const results: string[] = [];

  for (const rpc of RPCS) {
    try {
      const connection = new Connection(rpc.url, "confirmed");
      const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx) {
        results.push(rpc.name);
      }
    } catch {
      // ignore per-rpc failures
    }
  }

  const resultText =
    results.length > 0
      ? `Found on: ${results.join(", ")}`
      : "Not found on devnet/testnet/mainnet";

  return NextResponse.json({ result: resultText, matches: results });
}
