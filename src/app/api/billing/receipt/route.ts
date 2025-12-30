import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { signReceipt } from "@/lib/receipt";
import { verifyToken } from "@/lib/hmac-token";

const RECEIPT_SECRET =
  process.env.BILLING_RECEIPT_SECRET ?? "dev-secret-change-me";
const BILLING_AUTH_SECRET =
  process.env.BILLING_AUTH_SECRET ?? "dev-auth-secret-change-me";

type IntentAuthorizationPayload = {
  type: "intent-authorization";
  intent_id: string;
  wallet: string;
  signature_verified: boolean;
  chain?: string;
  exp: number;
  auth_session_id?: string;
  auth_hash?: string;
};

type DelegationTokenPayload = {
  type: "delegation-token";
  agent_id: string;
  limit: string;
  currency: string;
  wallet: string;
  provider: string;
  signature_verified: boolean;
  chain?: string;
  exp: number;
  auth_session_id?: string;
  auth_hash?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const amount = typeof body?.amount === "string" ? body.amount : "0.01";
  const currency = typeof body?.currency === "string" ? body.currency : "USDC";
  const walletAddress =
    typeof body?.walletAddress === "string" ? body.walletAddress : "unknown";
  const paymentIntentId =
    typeof body?.payment_intent_id === "string" ? body.payment_intent_id : "";
  const txHash = typeof body?.tx_hash === "string" ? body.tx_hash : "";
  const chainId = typeof body?.chain_id === "string" ? body.chain_id : "solana";
  const intentAuthorizationToken =
    typeof body?.intent_authorization_token === "string"
      ? body.intent_authorization_token
      : "";
  const delegationToken =
    typeof body?.delegation_token === "string" ? body.delegation_token : "";

  if (!paymentIntentId || !txHash) {
    return NextResponse.json(
      { error: "missing_fields", message: "payment_intent_id and tx_hash are required." },
      { status: 400 }
    );
  }

  let authorizationType: "intent" | "delegation" | null = null;
  let authMethod: string | undefined;
  let authSessionId: string | undefined;
  let authHash: string | undefined;

  if (intentAuthorizationToken) {
    const authResult = verifyToken<IntentAuthorizationPayload>(
      intentAuthorizationToken,
      BILLING_AUTH_SECRET
    );
    if (!authResult.ok) {
      return NextResponse.json(
        { error: "invalid_authorization", reason: authResult.error },
        { status: 401 }
      );
    }
    if (authResult.payload.wallet && authResult.payload.wallet !== walletAddress) {
      return NextResponse.json(
        { error: "wallet_mismatch" },
        { status: 401 }
      );
    }
    if (authResult.payload.intent_id !== paymentIntentId) {
      return NextResponse.json(
        { error: "intent_mismatch" },
        { status: 401 }
      );
    }
    if (!authResult.payload.signature_verified) {
      return NextResponse.json(
        { error: "signature_verification_failed" },
        { status: 401 }
      );
    }
    authMethod = "crossmint_session";
    authSessionId = authResult.payload.auth_session_id;
    authHash = authResult.payload.auth_hash;
    authorizationType = "intent";
  } else if (delegationToken) {
    const delegationResult = verifyToken<DelegationTokenPayload>(
      delegationToken,
      BILLING_AUTH_SECRET
    );
    if (!delegationResult.ok) {
      return NextResponse.json(
        { error: "invalid_delegation", reason: delegationResult.error },
        { status: 401 }
      );
    }
    if (delegationResult.payload.wallet !== walletAddress) {
      return NextResponse.json(
        { error: "wallet_mismatch" },
        { status: 401 }
      );
    }
    if (delegationResult.payload.currency !== currency) {
      return NextResponse.json(
        { error: "currency_mismatch" },
        { status: 401 }
      );
    }
    if (!delegationResult.payload.signature_verified) {
      return NextResponse.json(
        { error: "signature_verification_failed" },
        { status: 401 }
      );
    }
    const limit = Number(delegationResult.payload.limit);
    const amountValue = Number(amount);
    if (
      !Number.isFinite(limit) ||
      !Number.isFinite(amountValue) ||
      amountValue > limit
    ) {
      return NextResponse.json(
        { error: "limit_exceeded" },
        { status: 401 }
      );
    }
    authMethod = "crossmint_session";
    authSessionId = delegationResult.payload.auth_session_id;
    authHash = delegationResult.payload.auth_hash;
    authorizationType = "delegation";
  } else {
    return NextResponse.json(
      { error: "missing_authorization" },
      { status: 401 }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "finyx-billing",
    sub: walletAddress,
    aud: "finyx-provider",
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 10 * 60,
    amount,
    currency,
    chain_id: chainId,
    tx_hash: txHash,
    payment_intent_id: paymentIntentId,
    scope: "agent.access",
    authorization_type: authorizationType ?? undefined,
    auth_method: authMethod,
    auth_session_id: authSessionId,
    auth_hash: authHash,
  };

  const receipt = signReceipt(payload, RECEIPT_SECRET);

  return NextResponse.json({
    receipt,
    receipt_payload: payload,
  });
}
