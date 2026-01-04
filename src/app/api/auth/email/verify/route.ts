import { NextRequest, NextResponse } from "next/server";
import { isEmailValid } from "@crossmint/common-sdk-auth";
import { verifyEmailOtp } from "@/lib/email-otp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const emailId = typeof body?.emailId === "string" ? body.emailId : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!email || !emailId || !code) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!isEmailValid(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const result = verifyEmailOtp(emailId, email, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
