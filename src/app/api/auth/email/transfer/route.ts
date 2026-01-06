import { NextRequest, NextResponse } from "next/server";
import { sendWalletToken } from "@/lib/finyx-wallet-sdk";

const CROSSMINT_SERVER_SIDE_API_KEY = process.env
  .CROSSMINT_SERVER_SIDE_API_KEY as string;
const CROSSMINT_ENV = process.env.CROSSMINT_ENV || "staging";
const EMAIL_COOKIE = "finyx_email";
const USDC_STAGING =
  "solana:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC_PROD = "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const { walletLocator, recipient, amount } = body ?? {};
    if (!walletLocator || !recipient || !amount) {
      return NextResponse.json(
        { error: "wallet_locator_recipient_amount_required" },
        { status: 400 }
      );
    }

    const tokenLocator = CROSSMINT_ENV === "production" ? USDC_PROD : USDC_STAGING;
    const response = await sendWalletToken({
      walletLocator,
      tokenLocator,
      recipient,
      amount: String(amount),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: response.data?.error || "Failed to transfer funds",
          details: response.data,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(response.data);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unexpected error transferring funds", details: error?.message },
      { status: 500 }
    );
  }
}
