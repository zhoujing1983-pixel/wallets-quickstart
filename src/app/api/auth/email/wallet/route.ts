import { NextRequest, NextResponse } from "next/server";
import { createWallet } from "@/lib/finyx-wallet-sdk";

const CROSSMINT_SERVER_SIDE_API_KEY = process.env
  .CROSSMINT_SERVER_SIDE_API_KEY as string;
const EMAIL_COOKIE = "finyx_email";

const getChainType = (chain: string) => {
  const normalized = chain.toLowerCase();
  if (normalized.includes("solana")) return "solana";
  if (normalized.includes("stellar")) return "stellar";
  if (normalized.includes("aptos")) return "aptos";
  if (normalized.includes("sui")) return "sui";
  return "evm";
};

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

    const userLocator = `email:${email}`;
    const chain = process.env.NEXT_PUBLIC_CHAIN ?? "solana";
    const chainType = getChainType(chain);
    const walletAliasBase = process.env.CROSSMINT_WALLET_ALIAS ?? "server";
    const walletEnv = process.env.CROSSMINT_ENV ?? "staging";
    const walletAlias = `${walletAliasBase}-${walletEnv}`;
    const walletRequestBody = {
      chainType,
      type: "smart",
      config: {
        adminSigner: {
          type: "api-key",
        },
      },
      owner: userLocator,
      alias: walletAlias,
    };
    const walletResponse = await createWallet(walletRequestBody);
    if (!walletResponse.ok) {
      const responseData = walletResponse.data as { error?: string };
      return NextResponse.json(
        {
          error: responseData?.error || "Failed to create wallet",
          details: walletResponse.data,
        },
        { status: walletResponse.status }
      );
    }

    return NextResponse.json({
      wallet: walletResponse.data,
      userLocator,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unexpected error fetching wallet", details: error?.message },
      { status: 500 }
    );
  }
}
