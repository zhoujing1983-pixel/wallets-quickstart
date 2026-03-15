/*
 * 文件作用：聊天请求的总编排入口：构建 payload、选择 workflow、调用 runtime、格式化回包，并处理 stream/non-stream 分支。
 * 调用链阶段：路由与编排阶段（API 入站后）
 * 调用链关系：上游：src/app/api/agent/chat/route.ts::POST()；下游：src/agent/runtime/factory.ts::runtime.executeWorkflow()/executeWorkflowStream()、src/agent/routing/formatters/*.ts::format*WorkflowResult()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { matchKeywordRoute } from "@/agent/routing/route-selector";
import { formatReturnWorkflowResult } from "@/agent/routing/formatters/return-workflow";
import { formatFlightWorkflowResult } from "@/agent/routing/formatters/flight-workflow";
import { matchSimpleChatRule } from "@/agent/config/simple-chat-rule";
import { SIMPLE_CHAT_RULE_ENABLED } from "@/agent/config/simple-chat-config";
import { runtime } from "@/agent/runtime/factory";
import type {
  ChatOptions,
  WorkflowPayload,
  WorkflowResponse,
} from "@/agent/runtime/types";

/**
 * routeAgentChat 的输入结构。
 * - input: 用户原始问题；
 * - options: 前端可选开关；
 * - headerEnableThinking: 兼容旧客户端请求头透传。
 */
type RouteServiceInput = {
  input: string;
  options?: ChatOptions;
  headerEnableThinking?: boolean;
};

type UpstreamSseEvent = {
  event: string;
  data: unknown;
};

/**
 * 统一路由日志打印函数。
 * @param message 日志主信息
 * @param meta 可选结构化元信息
 */
const logRouting = (message: string, meta?: Record<string, unknown>) => {
  if (meta) {
    console.log(`[routing] ${message}`, meta);
  } else {
    console.log(`[routing] ${message}`);
  }
};

/**
 * 组装标准化 workflow 输入载荷。
 * - 融合环境变量默认值、请求体 options、旧请求头兼容字段；
 * - 保证下游 workflow 接收到一致结构。
 */
const buildWorkflowInput = (
  input: string,
  options: ChatOptions | undefined,
  headerEnableThinking: boolean | undefined
): WorkflowPayload => {
  const envNeedRag =
    (process.env.NEED_RAG ?? "true").toLowerCase() !== "false";
  const needRag =
    typeof options?.needRag === "boolean" ? options.needRag : envNeedRag;
  const useLlmSummary =
    typeof options?.useLlmSummary === "boolean"
      ? options.useLlmSummary
      : undefined;
  const ragRetriever =
    options?.ragRetriever === "pageindex" || options?.ragRetriever === "vector"
      ? options.ragRetriever
      : undefined;
  const userId = typeof options?.userId === "string" ? options.userId : undefined;
  const conversationId =
    typeof options?.conversationId === "string"
      ? options.conversationId
      : undefined;
  const enableThinking =
    typeof options?.enableThinking === "boolean"
      ? options.enableThinking
      : headerEnableThinking;
  const streamAnswer =
    typeof options?.streamAnswer === "boolean"
      ? options.streamAnswer
      : undefined;

  return {
    input: {
      query: input,
      options: {
        needRag,
        useLlmSummary,
        ragRetriever,
        userId,
        conversationId,
        enableThinking,
        streamAnswer,
      },
    },
    options: {
      userId,
      conversationId,
    },
  };
};

/**
 * 执行指定 workflow。
 * - 通过 runtime 工厂自动分发到 voltagent/langchain；
 * - 统一处理失败日志与异常抛出。
 */
const executeWorkflow = async (
  workflowId: string,
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const start = Date.now();
  const data = await runtime.executeWorkflow(workflowId, payload);
  if (!data?.success) {
    const message = data?.error || "Workflow request failed.";
    logRouting("workflow failed", {
      workflowId,
      durationMs: Date.now() - start,
      error: message,
    });
    throw new Error(message);
  }
  logRouting("workflow success", {
    workflowId,
    durationMs: Date.now() - start,
  });
  return data;
};

/**
 * 统一格式化 workflow 输出，保证聊天接口返回结构稳定。
 */
const formatWorkflowResult = (
  workflowId: string,
  result: Record<string, unknown>,
  durationMs: number
) => {
  if (workflowId === "direct-chat-workflow") {
    const replyText = typeof result.text === "string" ? result.text : "";
    const red = "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(`${red}[routing] direct-chat reply${reset}`, {
      workflowId,
      durationMs,
      reply: replyText,
    });
  }

  if (workflowId === "return-request-workflow") {
    const formatted = formatReturnWorkflowResult(result as any);
    logRouting("response formatted", {
      workflowId,
      durationMs,
    });
    return formatted;
  }
  if (workflowId === "flight-booking-workflow") {
    const formatted = formatFlightWorkflowResult(result as any);
    logRouting("response formatted", {
      workflowId,
      durationMs,
    });
    return formatted;
  }

  const sources = Array.isArray(result.sources) ? result.sources : [];
  const snippets = Array.isArray(result.snippets) ? result.snippets : [];
  const baseText = typeof result.text === "string" ? result.text : "";
  const response = {
    text: baseText,
    sources,
    snippets,
  };
  logRouting("response ready", {
    workflowId,
    durationMs,
  });
  return response;
};

const encodeSse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const parseUpstreamSse = async function* (
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<UpstreamSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const splitIndex = buffer.indexOf("\n\n");
      if (splitIndex < 0) break;
      const rawEvent = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);
      const lines = rawEvent.split("\n");
      let event = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length === 0) continue;
      const rawData = dataLines.join("\n");
      let parsed: unknown = rawData;
      try {
        parsed = JSON.parse(rawData);
      } catch {
        // Keep raw text when JSON parsing fails.
      }
      yield { event, data: parsed };
    }
  }
};

/**
 * 决策当前请求应走哪个 workflow。
 * 决策顺序：
 * 1) 关键词硬匹配；
 * 2) 简单闲聊规则；
 * 3) routing-workflow 模型判定；
 * 4) 兜底 local-rag-workflow。
 */
const resolveWorkflowId = async (
  input: string,
  payload: WorkflowPayload
): Promise<{ workflowId: string; directText?: string }> => {
  const start = Date.now();
  const keywordDecision = matchKeywordRoute(input);
  if (keywordDecision?.workflowId) {
    logRouting("keyword matched", {
      workflowId: keywordDecision.workflowId,
      reason: keywordDecision.reason,
      durationMs: Date.now() - start,
    });
    return { workflowId: keywordDecision.workflowId };
  }

  if (SIMPLE_CHAT_RULE_ENABLED) {
    const simpleChatDecision = matchSimpleChatRule(input);
    if (simpleChatDecision.isSimple) {
      const red = "\x1b[31m";
      const reset = "\x1b[0m";
      console.log(
        `${red}[routing] simple chat matched${reset}`,
        {
          workflowId: "direct-chat-workflow",
          reason: simpleChatDecision.reason,
          durationMs: Date.now() - start,
        }
      );
      return { workflowId: "direct-chat-workflow" };
    }
  }

  try {
    const routingRes = await executeWorkflow("routing-workflow", payload);
    const routingResult = routingRes?.data?.result as {
      workflowId?: string;
      directText?: string;
    };
    if (routingResult && typeof routingResult.workflowId === "string") {
      if (typeof routingResult.directText === "string") {
        const red = "\x1b[31m";
        const reset = "\x1b[0m";
        console.log(
          `${red}[routing] model direct reply${reset}`,
          {
            workflowId: routingResult.workflowId,
            durationMs: Date.now() - start,
            reply: routingResult.directText,
          }
        );
      } else {
        logRouting("model matched", {
          workflowId: routingResult.workflowId,
          durationMs: Date.now() - start,
        });
      }
      return {
        workflowId: routingResult.workflowId,
        directText:
          typeof routingResult.directText === "string"
            ? routingResult.directText
            : undefined,
      };
    }
  } catch (error) {
    logRouting("model fallback failed", {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logRouting("fallback to local-rag-workflow", {
    durationMs: Date.now() - start,
  });
  return { workflowId: "local-rag-workflow" };
};

/**
 * Agent 聊天总入口：
 * - 先决策 workflow；
 * - 执行 workflow；
 * - 按 workflow 类型做结果格式化；
 * - 最终返回前端统一结构（text/sources/snippets）。
 */
export const routeAgentChat = async ({
  input,
  options,
  headerEnableThinking,
}: RouteServiceInput) => {
  const start = Date.now();
  const payload = buildWorkflowInput(input, options, headerEnableThinking);
  const routingDecision = await resolveWorkflowId(input, payload);
  const { workflowId, directText } = routingDecision;
  if (workflowId === "direct-chat-workflow" && directText) {
    const red = "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(
      `${red}[routing] direct reply from routing${reset}`,
      {
        workflowId,
        durationMs: Date.now() - start,
        reply: directText,
      }
    );
    return { text: directText, sources: [], snippets: [] };
  }
  logRouting("executing workflow", { workflowId });
  const workflowRes = await executeWorkflow(workflowId, payload);
  logRouting("workflow raw response", { workflowId, workflowRes });
  const result = workflowRes?.data?.result;

  if (!result || typeof result !== "object") {
    logRouting("workflow result missing", { workflowId });
    throw new Error("Workflow result missing.");
  }

  return formatWorkflowResult(
    workflowId,
    result as Record<string, unknown>,
    Date.now() - start
  );
};

/**
 * Agent 聊天流式入口（SSE）：
 * - 与 routeAgentChat 使用同一套 workflow 路由决策；
 * - 对上游 LangChain stream 事件做透传（tool_progress）；
 * - 在 final 事件处复用 formatter，确保前端拿到统一结构。
 */
export const routeAgentChatStream = ({
  input,
  options,
  headerEnableThinking,
}: RouteServiceInput) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const start = Date.now();
      try {
        const payload = buildWorkflowInput(input, options, headerEnableThinking);
        const routingDecision = await resolveWorkflowId(input, payload);
        const { workflowId, directText } = routingDecision;
        if (workflowId === "direct-chat-workflow" && directText) {
          const finalData = { text: directText, sources: [], snippets: [] };
          controller.enqueue(
            encoder.encode(encodeSse("final", { workflowId, data: finalData }))
          );
          controller.enqueue(encoder.encode(encodeSse("done", { ok: true })));
          controller.close();
          return;
        }
        logRouting("executing workflow(stream)", { workflowId });
        if (runtime.executeWorkflowStream) {
          const upstream = await runtime.executeWorkflowStream(workflowId, payload);
          if (!upstream.body) {
            throw new Error("Workflow stream body missing.");
          }
          for await (const evt of parseUpstreamSse(upstream.body)) {
            if (evt.event === "tool_progress") {
              controller.enqueue(encoder.encode(encodeSse("tool_progress", evt.data)));
              continue;
            }
            if (evt.event === "text_delta") {
              controller.enqueue(encoder.encode(encodeSse("text_delta", evt.data)));
              continue;
            }
            if (evt.event === "final") {
              const finalPayload =
                evt.data && typeof evt.data === "object"
                  ? (evt.data as Record<string, unknown>)
                  : {};
              const rawResult =
                finalPayload.result && typeof finalPayload.result === "object"
                  ? (finalPayload.result as Record<string, unknown>)
                  : {};
              const formatted = formatWorkflowResult(
                workflowId,
                rawResult,
                Date.now() - start
              );
              controller.enqueue(
                encoder.encode(
                  encodeSse("final", {
                    workflowId,
                    data: formatted,
                  })
                )
              );
              continue;
            }
            if (evt.event === "error") {
              const detail =
                evt.data && typeof evt.data === "object"
                  ? (evt.data as Record<string, unknown>)
                  : { error: String(evt.data ?? "Workflow stream failed.") };
              controller.enqueue(encoder.encode(encodeSse("error", detail)));
              controller.close();
              return;
            }
          }
          controller.enqueue(encoder.encode(encodeSse("done", { ok: true })));
          controller.close();
          return;
        }

        const workflowRes = await executeWorkflow(workflowId, payload);
        const result = workflowRes?.data?.result;
        if (!result || typeof result !== "object") {
          throw new Error("Workflow result missing.");
        }
        const formatted = formatWorkflowResult(
          workflowId,
          result as Record<string, unknown>,
          Date.now() - start
        );
        controller.enqueue(
          encoder.encode(encodeSse("final", { workflowId, data: formatted }))
        );
        controller.enqueue(encoder.encode(encodeSse("done", { ok: true })));
        controller.close();
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            encodeSse("error", {
              error:
                error instanceof Error
                  ? error.message
                  : "Agent stream request failed.",
            })
          )
        );
        controller.close();
      }
    },
  });
};