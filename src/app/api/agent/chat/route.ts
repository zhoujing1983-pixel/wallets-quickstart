import { NextResponse } from "next/server";
import { queryLocalRag } from "@/lib/local-rag";

export const runtime = "nodejs";

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
    const mode = process.env.AGENT_PROXY_MODE ?? "local-rag";
    const options =
      body?.options && typeof body.options === "object" ? body.options : undefined;
    const ragMode = options?.ragMode === "llm" ? "llm" : "rag";
    if (ragMode === "rag" && (mode === "local-rag" || mode === "hybrid")) {
      const data = await queryLocalRag(input);
      const threshold = Number(process.env.RAG_DISTANCE_THRESHOLD ?? 0.35);
      const shouldFallback =
        mode === "hybrid" && (data.distance === null || data.distance > threshold);
      if (!shouldFallback) {
        return NextResponse.json({
          success: true,
          data: { text: data.text, sources: data.sources },
        });
      }
    }
    const agentId = "FinyxWaaSAgent";
    const res = await fetch(
      `http://localhost:3141/agents/${encodeURIComponent(agentId)}/text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ? { input, options } : { input }),
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
