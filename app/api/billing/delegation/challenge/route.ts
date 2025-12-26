import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { signToken } from "@/lib/hmac-token";

const BILLING_AUTH_SECRET =
  process.env.BILLING_AUTH_SECRET ?? "dev-auth-secret-change-me";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const walletAddress =
    typeof body?.walletAddress === "string" ? body.walletAddress : "";
  const limit = typeof body?.limit === "string" ? body.limit : "10.00";
  const currency = typeof body?.currency === "string" ? body.currency : "USDC";
  const agentId = typeof body?.agent_id === "string" ? body.agent_id : "finyx-agent";
  const provider = "finyx-provider";
  const authSessionId =
    typeof body?.auth_session_id === "string" && body.auth_session_id
      ? body.auth_session_id
      : crypto.randomUUID();

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 30 * 60;
  const nonce = crypto.randomUUID();
  const message = [
    "Authorize agent delegation",
    `agent_id: ${agentId}`,
    `limit: ${limit}`,
    `currency: ${currency}`,
    `wallet: ${walletAddress}`,
    `provider: ${provider}`,
    `nonce: ${nonce}`,
    `expires_at: ${expiresAt}`,
    `auth_session_id: ${authSessionId}`,
  ].join("\n");

  const authHash = crypto
    .createHash("sha256")
    .update(`${authSessionId}:${agentId}:${expiresAt}`)
    .digest("hex");

  const challengeToken = signToken(
    {
      type: "delegation-challenge",
      agent_id: agentId,
      limit,
      currency,
      wallet: walletAddress,
      provider,
      nonce,
      exp: expiresAt,
      message,
      auth_session_id: authSessionId,
      auth_hash: authHash,
    },
    BILLING_AUTH_SECRET
  );

  return NextResponse.json({
    delegation_message: message,
    challenge_token: challengeToken,
    expires_at: expiresAt,
    auth_session_id: authSessionId,
    auth_hash: authHash,
  });
}
