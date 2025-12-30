import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyReceipt } from "@/lib/receipt";

const RECEIPT_SECRET =
  process.env.BILLING_RECEIPT_SECRET ?? "dev-secret-change-me";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const receipt = typeof body?.receipt === "string" ? body.receipt : "";
  const amount = typeof body?.amount === "string" ? body.amount : "0.01";
  const currency = typeof body?.currency === "string" ? body.currency : "USDC";

  if (!receipt) {
    return NextResponse.json(
      {
        error: "payment_required",
        amount,
        currency,
        payment_intent_id: `pi_${crypto.randomUUID()}`,
        billing_url: "/api/billing/intent",
        receipt_schema: "JWT(HMAC-SHA256)",
      },
      { status: 402 }
    );
  }

  const verification = verifyReceipt(receipt, RECEIPT_SECRET);
  if (!verification.ok) {
    return NextResponse.json(
      { error: "invalid_receipt", reason: verification.error },
      { status: 401 }
    );
  }

  if (verification.payload.aud !== "finyx-provider") {
    return NextResponse.json(
      { error: "invalid_receipt", reason: "aud_mismatch" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    access: "granted",
    amount,
    currency,
    receipt_claims: verification.payload,
    message: "Receipt verified. Provider access granted.",
  });
}
