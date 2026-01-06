import { NextRequest, NextResponse } from "next/server";
import { submitTransactionApprovals } from "@/lib/finyx-wallet-sdk";

const CROSSMINT_SERVER_SIDE_API_KEY = process.env
  .CROSSMINT_SERVER_SIDE_API_KEY as string;
const EMAIL_COOKIE = "finyx_email";

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
    const { walletLocator, transactionId, signer, signature } = body ?? {};
    if (!walletLocator || !transactionId || !signer || !signature) {
      return NextResponse.json(
        { error: "approval_fields_required" },
        { status: 400 }
      );
    }

    const response = await submitTransactionApprovals({
      walletLocator,
      transactionId,
      approvals: [{ signer, signature }],
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: response.data?.error || "Failed to approve transfer",
          details: response.data,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(response.data);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unexpected error approving transfer", details: error?.message },
      { status: 500 }
    );
  }
}
