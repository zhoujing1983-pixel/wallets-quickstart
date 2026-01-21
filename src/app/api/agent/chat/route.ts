import { NextResponse } from "next/server";
import { routeAgentChat } from "@/agent/routing/route-service";

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
    const responseData = await routeAgentChat({
      input,
      options,
      headerEnableThinking,
    });
    return NextResponse.json({
      success: true,
      data: responseData,
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
