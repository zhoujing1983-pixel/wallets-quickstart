import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { signToken, verifyToken } from "@/lib/hmac-token";
import { verifySolanaMemoSignature } from "@/lib/solana-verify";

const BILLING_AUTH_SECRET =
  process.env.BILLING_AUTH_SECRET ?? "dev-auth-secret-change-me";
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const TRANSFER_OTP_COOKIE = "finyx_transfer_otp";
const EMAIL_COOKIE = "finyx_email";

type DelegationChallengePayload = {
  type: "delegation-challenge";
  agent_id: string;
  limit: string;
  currency: string;
  wallet: string;
  provider: string;
  nonce: string;
  exp: number;
  message: string;
  auth_session_id?: string;
  auth_hash?: string;
};

const isEvmAddress = (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address);

const verifySolanaMemo = async (
  signature: string,
  walletAddress: string
) => {
  return verifySolanaMemoSignature({
    rpcUrl: SOLANA_RPC_URL,
    signature,
    walletAddress,
  });
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const challengeToken =
    typeof body?.challenge_token === "string" ? body.challenge_token : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  const walletAddress =
    typeof body?.walletAddress === "string" ? body.walletAddress : "";
  const chain = typeof body?.chain === "string" ? body.chain : "";
  const transferOtp = req.cookies.get(TRANSFER_OTP_COOKIE)?.value ?? "";
  const emailSession = req.cookies.get(EMAIL_COOKIE)?.value ?? "";

  const hasOtp = Boolean(transferOtp && emailSession);
  if (!challengeToken || !walletAddress || (!signature && !hasOtp)) {
    return NextResponse.json(
      { error: "missing_fields" },
      { status: 400 }
    );
  }

  const tokenResult = verifyToken<DelegationChallengePayload>(
    challengeToken,
    BILLING_AUTH_SECRET
  );
  if (!tokenResult.ok) {
    return NextResponse.json(
      { error: "invalid_challenge_token", reason: tokenResult.error },
      { status: 401 }
    );
  }

  const payload = tokenResult.payload;
  if (payload.wallet && payload.wallet !== walletAddress) {
    return NextResponse.json(
      { error: "wallet_mismatch" },
      { status: 401 }
    );
  }

  let signatureVerified = false;
  if (hasOtp) {
    signatureVerified = true;
  } else if (isEvmAddress(walletAddress) && signature.startsWith("0x")) {
    try {
      signatureVerified = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message: payload.message,
        signature: signature as `0x${string}`,
      });
    } catch {
      signatureVerified = false;
    }
  } else if (chain === "solana" && signature) {
    signatureVerified = await verifySolanaMemo(signature, walletAddress);
  }

  if (!signatureVerified) {
    return NextResponse.json(
      { error: "signature_verification_failed" },
      { status: 401 }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const delegationToken = signToken(
    {
      type: "delegation-token",
      agent_id: payload.agent_id,
      limit: payload.limit,
      currency: payload.currency,
      wallet: walletAddress,
      provider: payload.provider,
      signature_verified: signatureVerified,
      chain,
      exp: now + 30 * 60,
      auth_session_id: payload.auth_session_id,
      auth_hash: payload.auth_hash,
    },
    BILLING_AUTH_SECRET
  );

  return NextResponse.json({
    delegation_token: delegationToken,
    signature_verified: signatureVerified,
  });
}
