import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/hmac-token";
import crypto from "crypto";

const BILLING_AUTH_SECRET =
  process.env.BILLING_AUTH_SECRET ?? "dev-auth-secret-change-me";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const amount = typeof body?.amount === "string" ? body.amount : "0.01";
  const currency = typeof body?.currency === "string" ? body.currency : "USDC";
  const walletAddress =
    typeof body?.walletAddress === "string" ? body.walletAddress : "";

  const paymentIntentId = `pi_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 10 * 60;
  const nonce = crypto.randomUUID();
  const provider = "finyx-provider";
  const authSessionId =
    typeof body?.auth_session_id === "string" && body.auth_session_id
      ? body.auth_session_id
      : crypto.randomUUID();
  const authHash = crypto
    .createHash("sha256")
    .update(`${authSessionId}:${paymentIntentId}:${expiresAt}`)
    .digest("hex");

  const intentMessage = [
    "Authorize payment intent",
    `intent_id: ${paymentIntentId}`,
    `amount: ${amount}`,
    `currency: ${currency}`,
    `wallet: ${walletAddress}`,
    `provider: ${provider}`,
    `nonce: ${nonce}`,
    `expires_at: ${expiresAt}`,
    `auth_session_id: ${authSessionId}`,
    `auth_hash: ${authHash}`,
  ].join("\n");

  const intentToken = signToken(
    {
      type: "intent-challenge",
      intent_id: paymentIntentId,
      amount,
      currency,
      wallet: walletAddress,
      provider,
      nonce,
      exp: expiresAt,
      message: intentMessage,
      auth_session_id: authSessionId,
      auth_hash: authHash,
    },
    BILLING_AUTH_SECRET
  );

  return NextResponse.json({
    payment_intent_id: paymentIntentId,
    amount,
    currency,
    walletAddress,
    provider,
    billing_url: "/api/billing/receipt",
    intent_message: intentMessage,
    intent_token: intentToken,
    intent_expires_at: expiresAt,
    auth_session_id: authSessionId,
    auth_hash: authHash,
  });
}
