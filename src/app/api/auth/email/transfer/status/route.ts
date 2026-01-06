import { NextRequest, NextResponse } from "next/server";
import { getWalletTransaction } from "@/lib/finyx-wallet-sdk";

const CROSSMINT_SERVER_SIDE_API_KEY = process.env
  .CROSSMINT_SERVER_SIDE_API_KEY as string;
const EMAIL_COOKIE = "finyx_email";

export async function GET(req: NextRequest) {
  try {
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
    const transactionId = req.nextUrl.searchParams.get("transactionId") ?? "";
    if (!walletLocator || !transactionId) {
      return NextResponse.json(
        { error: "wallet_locator_transaction_id_required" },
        { status: 400 }
      );
    }

    const response = await getWalletTransaction({
      walletLocator,
      transactionId,
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: response.data?.error || "Failed to fetch transaction",
          details: response.data,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(response.data);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unexpected error fetching transaction", details: error?.message },
      { status: 500 }
    );
  }
}
