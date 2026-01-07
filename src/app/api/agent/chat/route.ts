import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = typeof body?.input === "string" ? body.input : "";
    if (!input.trim()) {
      return NextResponse.json(
        { success: false, error: "Missing input." },
        { status: 400 }
      );
    }
    const agentId = "Finyx WaaS Agent";
    const res = await fetch(
      `http://localhost:3141/agents/${encodeURIComponent(agentId)}/text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      }
    );
    const data = await res.json();
    if (!res.ok || !data?.success) {
      return NextResponse.json(
        { success: false, error: data?.error || "Agent request failed." },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, data: data.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent request failed.";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
