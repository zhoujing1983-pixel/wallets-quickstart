import { NextRequest, NextResponse } from "next/server";
import { getWalletBalances } from "@/lib/finyx-wallet-sdk";

const CROSSMINT_SERVER_SIDE_API_KEY = process.env
  .CROSSMINT_SERVER_SIDE_API_KEY as string;
const EMAIL_COOKIE = "finyx_email";

export async function GET(req: NextRequest) {
  if (!CROSSMINT_SERVER_SIDE_API_KEY) {
    return NextResponse.json(
      { error: "CROSSMINT_SERVER_SIDE_API_KEY missing" },
      { status: 500 }
    );
  }

  const email = req.cookies.get(EMAIL_COOKIE)?.value ?? "";
  if (!email) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const walletLocator = req.nextUrl.searchParams.get("walletLocator") ?? "";
  const tokens = req.nextUrl.searchParams.get("tokens") ?? "USDC";
  if (!walletLocator) {
    return NextResponse.json(
      { error: "wallet_locator_required" },
      { status: 400 }
    );
  }

  try {
    const res = await getWalletBalances({ walletLocator, tokens });
    if (!res.ok) {
      return NextResponse.json(
        {
          error: res.data?.error || "Failed to fetch balance",
          details: res.data,
        },
        { status: res.status }
      );
    }
    return NextResponse.json(res.data);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unexpected error fetching balance", details: error?.message },
      { status: 500 }
    );
  }
}
