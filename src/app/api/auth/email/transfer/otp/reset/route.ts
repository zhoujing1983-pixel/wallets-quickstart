import { NextResponse } from "next/server";

const TRANSFER_OTP_COOKIE = "finyx_transfer_otp";

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(TRANSFER_OTP_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
  return res;
}
