/*
 * 文件作用：LangChain workflow 编排器：按 workflowId 分发 direct-chat/local-rag/flight 等逻辑并统一 stream 事件。
 * 调用链阶段：LangChain 执行阶段（workflow 分发与模型/工具调用）
 * 调用链关系：上游：scripts/langchain-server.ts::executeLangChainWorkflow()/executeLangChainWorkflowStream()；下游：src/agent/runtime/langchain/chat-runtime.ts::invokeText()/invokeTextStream()、src/agent/runtime/langchain/flight-runtime.ts::runFlightAgent()/executeFlightWorkflow()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { ROUTING_WORKFLOWS } from "@/agent/config/routing-config";
import { queryLocalRag } from "@/agent/retrievers/RAG-local-retriever";
import {
  DEFAULT_SYSTEM_PROMPT,
  extractFirstJson,
  getChatModel,
  invokeText,
  invokeTextStream,
  modelConfig,
  rememberConversationTurn,
  resolveConversationId,
  resolveStreamAnswerEnabled,
} from "@/agent/runtime/langchain/chat-runtime";
import {
  createFlightRuntime,
  type FlightToolProgressEvent,
} from "@/agent/runtime/langchain/flight-runtime";
import type { WorkflowPayload, WorkflowResponse } from "@/agent/runtime/types";

/**
 * 路由工作流模型输出的结构化结果。
 * - workflowId: 下游需要执行的 workflow；
 * - directText: 可选的直接回复（用于简单闲聊直答）。
 */
type RoutingResult = {
  workflowId?: string;
  directText?: string;
};

// 混合模式下本地 RAG 的距离阈值，超过则回退到纯对话回答。
const RAG_DISTANCE_THRESHOLD = Number(process.env.RAG_DISTANCE_THRESHOLD ?? "0.9");
// 路由失败时的安全回退 workflow。
const FALLBACK_WORKFLOW = "local-rag-workflow";

const flightRuntime = createFlightRuntime({
  resolveConversationId,
  getChatModel,
  defaultModelName: modelConfig.model,
  extractFirstJson,
});

/**
 * 判断路由结果是否属于白名单 workflow。
 * - 防止模型输出未知 workflowId 导致异常调用。
 */
const isAllowedWorkflow = (workflowId: string) =>
  (ROUTING_WORKFLOWS as readonly string[]).includes(workflowId);

/**
 * 执行 routing-workflow：
 * - 让模型在白名单内选择 workflow；
 * - 若模型失败或输出非法，回退到 local-rag-workflow。
 */
const executeRoutingWorkflow = async (
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const query = payload.input.query.trim();
  const system =
    "You are a routing agent. Return JSON only with fields workflowId and directText. " +
    `Allowed workflowId values: ${ROUTING_WORKFLOWS.join(", ")}. ` +
    "If the user intent is a short greeting/chit-chat, choose direct-chat-workflow and provide directText.";
  const user = `User input:\n${query}`;
  try {
    const raw = await invokeText(system, user, {
      memoryMode: "off",
      logTag: "routing",
    });
    const parsed = extractFirstJson<RoutingResult>(raw);
    if (parsed?.workflowId && isAllowedWorkflow(parsed.workflowId)) {
      return {
        success: true,
        data: {
          result: {
            workflowId: parsed.workflowId,
            directText:
              typeof parsed.directText === "string" ? parsed.directText : undefined,
          },
        },
      };
    }
  } catch (error) {
    console.warn("[langchain:routing] model route failed", error);
  }
  return {
    success: true,
    data: { result: { workflowId: FALLBACK_WORKFLOW } },
  };
};

/**
 * 执行 direct-chat-workflow（纯聊天）。
 */
const executeDirectChatWorkflow = async (
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const query = payload.input.query.trim();
  const conversationId = resolveConversationId(payload);
  console.log("[langchain:direct-chat:stream-toggle]", {
    streamAnswer: false,
    conversationId: conversationId ?? null,
    path: "non-stream",
  });
  const text = await invokeText(DEFAULT_SYSTEM_PROMPT, query, {
    conversationId,
    memoryMode: "read_write",
    memoryUserText: query,
    logTag: "direct-chat",
  });
  return { success: true, data: { result: { text } } };
};

const executeDirectChatWorkflowStream = async (
  payload: WorkflowPayload,
  onDelta: (delta: string) => void
) => {
  const query = payload.input.query.trim();
  const conversationId = resolveConversationId(payload);
  const text = await invokeTextStream(DEFAULT_SYSTEM_PROMPT, query, {
    conversationId,
    memoryMode: "read_write",
    memoryUserText: query,
    logTag: "direct-chat-stream",
    onDelta,
  });
  return text;
};

/**
 * 基于检索片段做二次总结。
 */
const summarizeRagAnswer = async (
  conversationId: string | undefined,
  query: string,
  snippets: Array<{ title: string; url?: string; content: string }>
) => {
  const refs = snippets
    .map(
      (item, index) =>
        `[${index + 1}] ${item.title}${item.url ? ` (${item.url})` : ""}\n${item.content}`
    )
    .join("\n\n");
  const system =
    "You answer strictly based on references. If references are insufficient, say 不知道. Keep answer concise.";
  const user = `Question: ${query}\n\nReferences:\n${refs}\n\nReturn only final answer text.`;
  return invokeText(system, user, {
    conversationId,
    memoryMode: "read_only",
    logTag: "rag-summary",
  });
};

/**
 * 执行 local-rag-workflow：
 * 1) needRag=false 时直接回到 direct-chat；
 * 2) needRag=true 时走本地检索；
 * 3) hybrid 模式下，距离超阈值回退 direct-chat；
 * 4) 可选用模型对检索结果再总结。
 */
const executeLocalRagWorkflow = async (
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const query = payload.input.query.trim();
  const conversationId = resolveConversationId(payload);
  const options = payload.input.options;
  const mode = (process.env.AGENT_PROXY_MODE ?? "local-rag").trim().toLowerCase();
  const useLlmSummary =
    typeof options.useLlmSummary === "boolean"
      ? options.useLlmSummary
      : (process.env.LOCAL_RAG_USE_LLM_SUMMARY ?? "false").trim().toLowerCase() === "true";

  if (!options.needRag) {
    return executeDirectChatWorkflow(payload);
  }

  const rag = await queryLocalRag(query);
  const shouldFallbackByDistance =
    mode === "hybrid" &&
    typeof rag.distance === "number" &&
    Number.isFinite(RAG_DISTANCE_THRESHOLD) &&
    rag.distance > RAG_DISTANCE_THRESHOLD;

  if (shouldFallbackByDistance) {
    return executeDirectChatWorkflow(payload);
  }

  const text =
    useLlmSummary && Array.isArray(rag.snippets) && rag.snippets.length > 0
      ? await summarizeRagAnswer(conversationId, query, rag.snippets)
      : rag.text;
  const ragToolResult = {
    tool: "local_rag_query",
    result: {
      sources: rag.sources,
      snippets: (rag.snippets ?? []).slice(0, 4),
      score: rag.score,
      distance: rag.distance,
    },
  };
  rememberConversationTurn(conversationId, query, text, [ragToolResult]);

  return {
    success: true,
    data: {
      result: {
        text,
        sources: rag.sources,
        snippets: rag.snippets ?? [],
      },
    },
  };
};

/**
 * 执行 return-request-workflow。
 */
const executeReturnWorkflow = async (
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const query = payload.input.query.trim();
  const conversationId = resolveConversationId(payload);
  const system =
    "You are a return request support agent. Ask for missing fields clearly if needed. Keep concise.";
  const replyText = await invokeText(system, query, {
    conversationId,
    memoryMode: "read_write",
    memoryUserText: query,
    logTag: "return",
  });
  return {
    success: true,
    data: {
      result: {
        replyText,
      },
    },
  };
};

/**
 * 未支持 workflow 的兜底响应。
 */
const executeUnknownWorkflow = (workflowId: string): WorkflowResponse => ({
  success: false,
  error: `Unsupported workflow in langchain runtime: ${workflowId}`,
});

/**
 * LangChain 执行器统一入口。
 */
export const executeLangChainWorkflow = async (
  workflowId: string,
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const executor = WORKFLOW_EXECUTORS[workflowId];
  if (executor) return executor(payload);
  return executeUnknownWorkflow(workflowId);
};

type LangChainWorkflowStreamEvent =
  | { type: "tool_progress"; data: FlightToolProgressEvent }
  | { type: "text_delta"; delta: string }
  | { type: "final"; result: unknown };

type StreamWorkflowExecutor = (
  workflowId: string,
  payload: WorkflowPayload,
  emit: (event: LangChainWorkflowStreamEvent) => void
) => Promise<void>;

const executeDirectChatWorkflowStreamEntry: StreamWorkflowExecutor = async (
  _workflowId,
  payload,
  emit
) => {
  const enableStream = resolveStreamAnswerEnabled(payload);
  const conversationId = resolveConversationId(payload);
  console.log("[langchain:direct-chat:stream-toggle]", {
    streamAnswer: enableStream,
    conversationId: conversationId ?? null,
    path: "stream-entry",
  });
  const text = enableStream
    ? await executeDirectChatWorkflowStream(payload, (delta) => {
        emit({ type: "text_delta", delta });
      })
    : (
        (await executeDirectChatWorkflow(payload)).data?.result as
          | { text?: string }
          | undefined
      )?.text ?? "";
  emit({
    type: "final",
    result: { text },
  });
};

const executeFlightWorkflowStreamEntry: StreamWorkflowExecutor = async (
  _workflowId,
  payload,
  emit
) => {
  const agentResult = await flightRuntime.runFlightAgent(payload, (progress) => {
    emit({ type: "tool_progress", data: progress });
  });
  emit({
    type: "final",
    result: {
      replyText: agentResult.replyText,
      offers: agentResult.offers,
      offerRequestId: agentResult.offerRequestId,
      offerCount: agentResult.offerCount,
      search: agentResult.search,
    },
  });
};

const executeDefaultWorkflowStreamEntry: StreamWorkflowExecutor = async (
  workflowId,
  payload,
  emit
) => {
  const result = await executeLangChainWorkflow(workflowId, payload);
  emit({
    type: "final",
    result: result?.data?.result ?? {},
  });
};

/**
 * LangChain 工作流流式执行入口。
 */
export const executeLangChainWorkflowStream = async (
  workflowId: string,
  payload: WorkflowPayload,
  emit: (event: LangChainWorkflowStreamEvent) => void
) => {
  const executor =
    STREAM_WORKFLOW_EXECUTORS[workflowId] ?? executeDefaultWorkflowStreamEntry;
  await executor(workflowId, payload, emit);
};

const WORKFLOW_EXECUTORS: Record<
  string,
  (payload: WorkflowPayload) => Promise<WorkflowResponse>
> = {
  "routing-workflow": executeRoutingWorkflow,
  "direct-chat-workflow": executeDirectChatWorkflow,
  "local-rag-workflow": executeLocalRagWorkflow,
  "return-request-workflow": executeReturnWorkflow,
  "flight-booking-workflow": flightRuntime.executeFlightWorkflow,
};

const STREAM_WORKFLOW_EXECUTORS: Record<string, StreamWorkflowExecutor> = {
  "direct-chat-workflow": executeDirectChatWorkflowStreamEntry,
  "flight-booking-workflow": executeFlightWorkflowStreamEntry,
};