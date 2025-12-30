import { NextRequest, NextResponse } from "next/server";

const CROSSMINT_SERVER_SIDE_API_KEY = process.env
  .CROSSMINT_SERVER_SIDE_API_KEY as string;
const CROSSMINT_ENV = process.env.CROSSMINT_ENV || "staging";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userLocator: string }> }
) {
  try {
    if (!CROSSMINT_SERVER_SIDE_API_KEY) {
      return NextResponse.json(
        {
          error:
            "Server misconfiguration: CROSSMINT_SERVER_SIDE_API_KEY missing",
        },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { userLocator } = await params;
    const baseUrl =
      CROSSMINT_ENV === "production"
        ? "https://www.crossmint.com"
        : "https://staging.crossmint.com";

    console.log(`[users:put] ${userLocator}`);
    console.log(`[users:put] payload=${JSON.stringify(body)}`);
    const response = await fetch(
      `${baseUrl}/api/2025-06-09/users/${userLocator}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": CROSSMINT_SERVER_SIDE_API_KEY,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    console.log(`[users:put] status=${response.status}`);
    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error || "Failed to update user", details: data },
        { status: response.status }
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unexpected error updating user", details: error?.message },
      { status: 500 }
    );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userLocator: string }> }
) {
  try {
    if (!CROSSMINT_SERVER_SIDE_API_KEY) {
      return NextResponse.json(
        {
          error:
            "Server misconfiguration: CROSSMINT_SERVER_SIDE_API_KEY missing",
        },
        { status: 500 }
      );
    }

    const { userLocator } = await params;
    const baseUrl =
      CROSSMINT_ENV === "production"
        ? "https://www.crossmint.com"
        : "https://staging.crossmint.com";

    console.log(`[users:get] ${userLocator}`);
    const response = await fetch(
      `${baseUrl}/api/2025-06-09/users/${userLocator}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": CROSSMINT_SERVER_SIDE_API_KEY,
        },
      }
    );

    const data = await response.json();
    console.log(`[users:get] status=${response.status}`);
    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error || "Failed to fetch user", details: data },
        { status: response.status }
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unexpected error fetching user", details: error?.message },
      { status: 500 }
    );
  }
}
