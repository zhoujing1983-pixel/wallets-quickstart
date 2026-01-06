import { NextRequest, NextResponse } from "next/server";
import { isEmailValid } from "@crossmint/common-sdk-auth";
import { verifyTransferOtp } from "@/lib/email-otp";

export const runtime = "nodejs";

const EMAIL_COOKIE = "finyx_email";
const TRANSFER_OTP_COOKIE = "finyx_transfer_otp";

export async function POST(req: NextRequest) {
  const email = req.cookies.get(EMAIL_COOKIE)?.value ?? "";
  if (!email) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const emailId = typeof body?.emailId === "string" ? body.emailId : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!emailId || !code) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!isEmailValid(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!/^[0-9]{10}$/.test(code)) {
    return NextResponse.json({ error: "invalid_code_format" }, { status: 400 });
  }

  const result = await verifyTransferOtp(emailId, email, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(TRANSFER_OTP_COOKIE, "approved", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
