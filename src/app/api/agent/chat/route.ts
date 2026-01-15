import { NextResponse } from "next/server";
import { queryLocalRag } from "@/lib/local-rag";

const normalizeReasonFromMessage = (
  message: Record<string, unknown> | undefined
): string | undefined => {
  if (!message) {
    return undefined;
  }
  const reasoningContent = message.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent.trim()) {
    return reasoningContent.trim();
  }
  const reasoningField = message.reasoning;
  if (typeof reasoningField === "string" && reasoningField.trim()) {
    return reasoningField.trim();
  }
  return undefined;
};

const extractReasoningFromResponse = (output: unknown): string | undefined => {
  if (!output || typeof output !== "object") {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  const reasoningText =
    typeof record.reasoningText === "string" && record.reasoningText.trim()
      ? record.reasoningText.trim()
      : undefined;
  if (reasoningText) {
    return reasoningText;
  }
  const reasoningField =
    typeof record.reasoning === "string" && record.reasoning.trim()
      ? record.reasoning.trim()
      : undefined;
  if (reasoningField) {
    return reasoningField;
  }
  const providerResponse = record.providerResponse as
    | {
        choices?: Array<{ message?: Record<string, unknown> }>;
        messages?: Array<Record<string, unknown>>;
        body?: {
          choices?: Array<{ message?: Record<string, unknown> }>;
          messages?: Array<Record<string, unknown>>;
        };
      }
    | undefined;
  const choices =
    providerResponse?.choices ??
    providerResponse?.body?.choices ??
    undefined;
  if (choices) {
    for (const choice of choices) {
      const reasoning = normalizeReasonFromMessage(choice?.message);
      if (reasoning) {
        return reasoning;
      }
    }
  }
  const messages =
    providerResponse?.messages ??
    providerResponse?.body?.messages ??
    undefined;
  if (messages) {
    for (const message of messages) {
      const reasoning = normalizeReasonFromMessage(message);
      if (reasoning) {
        return reasoning;
      }
    }
  }
  return undefined;
};

const wrapTextWithReason = (reasoning: string, text?: string) => {
  const trimmedReasoning = reasoning.trim();
  if (!trimmedReasoning) {
    return text ?? "";
  }
  const reasonBlock = `<reason>${trimmedReasoning}</reason>`;
  if (!text) {
    return reasonBlock;
  }
  return `${reasonBlock}\n${text}`;
};

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
    const enableThinking =
      typeof options?.enableThinking === "boolean"
        ? options.enableThinking
        : undefined;
    const provider = (process.env.MODEL_PROVIDER ?? "ollama").toLowerCase();
    const enableThinkingHeader =
      provider === "qwen" && enableThinking !== undefined
        ? { "x-qwen-enable-thinking": String(enableThinking) }
        : undefined;
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
    const agentRequestBody = {
      input,
      ...(options
        ? {
            options: {
              ...options,
              ...(enableThinkingHeader
                ? {
                    headers: {
                      ...(options?.headers &&
                      typeof options.headers === "object"
                        ? options.headers
                        : {}),
                      ...enableThinkingHeader,
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
    const res = await fetch(
      `http://localhost:3141/agents/${encodeURIComponent(agentId)}/text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentRequestBody),
      }
    );
    const data = await res.json();
    console.log("[agent:route-input]", data);
    if (!res.ok || !data?.success) {
      return NextResponse.json(
        { success: false, error: data?.error || "Agent request failed." },
        { status: 502 }
      );
    }
    if (data?.data) {
      const reasoning = extractReasoningFromResponse(data.data);
      if (reasoning) {
        const currentText =
          typeof data.data.text === "string" ? data.data.text : undefined;
        data.data.text = wrapTextWithReason(reasoning, currentText);
      }
    }
    return NextResponse.json({ success: true, data: data.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent request failed.";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
