import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message : "";
  const walletAddress =
    typeof body?.walletAddress === "string" ? body.walletAddress : "";
  const authHash =
    typeof body?.auth_hash === "string" ? body.auth_hash : "";

  if (!message || !walletAddress) {
    return NextResponse.json(
      { error: "missing_fields" },
      { status: 400 }
    );
  }

  const memoMessage =
    authHash && !message.includes(`auth_hash: ${authHash}`)
      ? `${message}\nauth_hash: ${authHash}`
      : message;
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");

  const memoInstruction = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [
      {
        pubkey: new PublicKey(walletAddress),
        isSigner: true,
        isWritable: false,
      },
    ],
    data: Buffer.from(memoMessage, "utf8"),
  });

  const messageV0 = new TransactionMessage({
    payerKey: new PublicKey(walletAddress),
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [memoInstruction],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  const serializedBuffer = Buffer.from(transaction.serialize());
  const serializedTransaction = serializedBuffer.toString("base64");
  const serializedTransactionBase58 = bs58.encode(serializedBuffer);

  return NextResponse.json({
    serializedTransaction,
    serializedTransactionBase58,
    blockhash: latestBlockhash.blockhash,
  });
}
