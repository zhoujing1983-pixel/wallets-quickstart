import { NextRequest, NextResponse } from "next/server";

const EMAIL_COOKIE = "finyx_email";

export async function GET(req: NextRequest) {
  const email = req.cookies.get(EMAIL_COOKIE)?.value ?? "";
  if (!email) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, email });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(EMAIL_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
  return res;
}
