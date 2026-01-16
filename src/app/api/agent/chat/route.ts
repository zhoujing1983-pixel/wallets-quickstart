import { NextResponse } from "next/server";

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
    // 将前端 options 原样接收，交给 workflow 决定检索/回退策略。
    const options =
      body?.options && typeof body.options === "object"
        ? body.options
        : undefined;
    /*
     * 兼容旧流程的 Think 开关传递：
     * - 旧版本通过请求头 x-qwen-enable-thinking 控制 Qwen 推理；
     * - 新流程主要走 body.options.enableThinking；
     * - 为兼容旧客户端，这里优先从请求体读取，缺失时回退读取请求头。
     */
    const headerThinking = request.headers.get("x-qwen-enable-thinking");
    const headerEnableThinking =
      headerThinking === "true"
        ? true
        : headerThinking === "false"
        ? false
        : undefined;
    const ragMode = options?.ragMode === "llm" ? "llm" : "rag";
    const userId =
      typeof options?.userId === "string" ? options.userId : undefined;
    const conversationId =
      typeof options?.conversationId === "string"
        ? options.conversationId
        : undefined;
    // workflow 输入结构：query + options（用于 RAG/LLM 分支与会话信息）。
    const workflowRequestBody = {
      input: {
        query: input,
        options: {
          ragMode,
          userId,
          conversationId,
          enableThinking:
            typeof options?.enableThinking === "boolean"
              ? options.enableThinking
              : headerEnableThinking,
        },
      },
      // workflow 执行 options 与聊天 session 绑定，方便后续扩展。
      options: {
        userId,
        conversationId,
      },
    };
    /*
     * 统一走 workflow 入口：
     * - 由 workflow 内部决定是否使用本地 RAG / LLM 回退；
     * - 路由层只负责传参与结果透传，避免重复业务逻辑。
     */
    const res = await fetch(
      "http://localhost:3141/workflows/local-rag-workflow/execute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflowRequestBody),
      }
    );
    const data = await res.json();
    console.log("[workflow:route-input]", data);
    if (!res.ok || !data?.success) {
      return NextResponse.json(
        { success: false, error: data?.error || "Workflow request failed." },
        { status: 502 }
      );
    }
    const result = data?.data?.result;
    if (!result || typeof result !== "object") {
      return NextResponse.json(
        { success: false, error: "Workflow result missing." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      success: true,
      data: {
        text: typeof result.text === "string" ? result.text : "",
        sources: Array.isArray(result.sources) ? result.sources : [],
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Workflow request failed.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 502 }
    );
  }
}
