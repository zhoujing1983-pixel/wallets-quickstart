import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ROUTING_WORKFLOWS } from "@/agent/config/routing-config";
import { queryLocalRag } from "@/agent/retrievers/RAG-local-retriever";
import { resolveIataCode } from "@/agent/airports/airports-index";
import {
  runDuffelSearchOffers,
  type OfferRequestInput,
} from "@/agent/tools/duffel-flight-tool";
import { z } from "zod";
import { createAgent, createMiddleware } from "langchain";
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

/**
 * 航班查询参数抽取结果：
 * - 来源于 LLM 的 JSON 抽取；
 * - 后续会经过 normalizeFlightInput 归一化和校验。
 */
type FlightExtraction = {
  slices?: Array<{
    origin?: string;
    destination?: string;
    departure_date?: string;
  }>;
  passengers?: Array<{
    type?: "adult" | "child" | "infant_without_seat";
    age?: number;
  }>;
  cabin_class?: "first" | "business" | "premium_economy" | "economy";
  max_connections?: number;
  supplier_timeout?: number;
  maxOffers?: number;
};

// 混合模式下本地 RAG 的距离阈值，超过则回退到纯对话回答。
const RAG_DISTANCE_THRESHOLD = Number(process.env.RAG_DISTANCE_THRESHOLD ?? "0.9");
// 路由失败时的安全回退 workflow。
const FALLBACK_WORKFLOW = "local-rag-workflow";
// LangChain 模式默认系统提示词，优先支持环境变量覆盖。
const DEFAULT_SYSTEM_PROMPT =
  process.env.LANGCHAIN_SYSTEM_PROMPT?.trim() ||
  process.env.VOLTAGENT_INSTRUCTIONS?.trim() ||
  "You are a Web3 payments assistant. Keep responses brief.";
// 瞬时记忆保留轮数（每轮含 user/assistant/可选工具结果）。
const WORKING_MEMORY_MAX_TURNS = Number(
  process.env.LANGCHAIN_WORKING_MEMORY_MAX_TURNS ?? "6"
);
// Flight Agent 最大循环步数配置。
const FLIGHT_AGENT_MAX_STEPS = Number(
  process.env.LANGCHAIN_FLIGHT_AGENT_MAX_STEPS ?? "4"
);
// Flight Agent 固定模型覆盖（最高优先级）。
const FLIGHT_AGENT_MODEL = process.env.LANGCHAIN_FLIGHT_AGENT_MODEL?.trim();
// Flight Agent 在启用 thinking 时的模型覆盖。
const FLIGHT_AGENT_THINKING_MODEL = process.env.LANGCHAIN_FLIGHT_AGENT_THINKING_MODEL?.trim();

/**
 * 记忆里的工具结果结构：
 * - tool: 工具名；
 * - result: 工具输出（字符串或对象）。
 */
type WorkingMemoryMessage = {
  tool: string;
  result: unknown;
};

/**
 * 会话记忆中的“一轮”结构。
 */
type WorkingMemoryTurn = {
  user: string;
  assistant: string;
  tools?: WorkingMemoryMessage[];
  timestamp: number;
};

/**
 * 模型调用时的记忆读写模式。
 */
type MemoryMode = "off" | "read_only" | "read_write";

/**
 * invokeText 的可选运行参数。
 */
type InvokeOptions = {
  conversationId?: string;
  memoryMode?: MemoryMode;
  memoryUserText?: string;
  memoryTools?: WorkingMemoryMessage[];
  logTag?: string;
};

/**
 * Flight Agent 执行后的统一结果结构。
 */
type FlightAgentRunResult = {
  replyText: string;
  offers: Array<{ id: string; total_amount: string; total_currency: string }>;
  offerRequestId: string;
  offerCount: number;
  search: OfferRequestInput | null;
  reason?: string;
  tools: WorkingMemoryMessage[];
};

// 工具结果写入记忆时的长度上限，避免上下文被大段 JSON 撑爆。
const WORKING_MEMORY_TOOL_RESULT_MAX_CHARS = Number(
  process.env.LANGCHAIN_WORKING_MEMORY_TOOL_RESULT_MAX_CHARS ?? "1200"
);

// 进程内会话记忆（瞬时记忆）：按 conversationId 保存最近多轮对话。
const workingMemoryStore = new Map<string, WorkingMemoryTurn[]>();

/**
 * 解析模型配置：
 * - 支持 qwen / lmstudio / openai；
 * - 统一输出 ChatOpenAI 所需的 model、apiKey、baseURL 配置。
 */
const pickModelConfig = () => {
  const provider = (process.env.MODEL_PROVIDER ?? "qwen").trim().toLowerCase();
  if (provider === "lmstudio") {
    return {
      model: process.env.LM_STUDIO_MODEL ?? "qwen/qwen3-1.7b",
      apiKey: process.env.LM_STUDIO_API_KEY ?? "lm-studio",
      configuration: { baseURL: process.env.LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1" },
    };
  }
  if (provider === "openai") {
    return {
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY ?? "",
      configuration: { baseURL: process.env.OPENAI_BASE_URL },
    };
  }
  return {
    model: process.env.QWEN_MODEL ?? "qwen-plus",
    apiKey: process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? "",
    configuration: {
      baseURL:
        process.env.QWEN_BASE_URL ??
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  };
};

// 进程级单例模型，避免每个请求重复初始化客户端。
const modelConfig = pickModelConfig();
// 按模型名缓存 ChatOpenAI 实例，降低高并发下重复构造成本。
const chatModelCache = new Map<string, ChatOpenAI>();

/**
 * 获取（或创建）指定模型名对应的 ChatOpenAI 实例。
 * - 先按模型名命中进程内缓存，避免重复创建客户端；
 * - 未传 modelName 时回退到默认 modelConfig.model；
 * - 创建后写回缓存，供后续请求复用。
 */
const getChatModel = (modelName?: string) => {
  const name = (modelName && modelName.trim()) || modelConfig.model;
  const cached = chatModelCache.get(name);
  if (cached) return cached;
  const created = new ChatOpenAI({
    model: name,
    temperature: 0.2,
    apiKey: modelConfig.apiKey,
    configuration: modelConfig.configuration,
    maxRetries: 1,
  });
  chatModelCache.set(name, created);
  return created;
};

// 默认模型实例（无特定覆盖时使用）。
const chatModel = getChatModel(modelConfig.model);

/**
 * 解析 flight agent 本次调用要使用的模型覆盖值。
 * 优先级：
 * 1) LANGCHAIN_FLIGHT_AGENT_MODEL；
 * 2) enableThinking=true 且配置 LANGCHAIN_FLIGHT_AGENT_THINKING_MODEL；
 * 3) undefined（使用默认模型）。
 */
const resolveFlightAgentModelOverride = (payload: WorkflowPayload) => {
  if (FLIGHT_AGENT_MODEL) {
    return FLIGHT_AGENT_MODEL;
  }
  const enableThinking = payload.input.options?.enableThinking;
  if (enableThinking && FLIGHT_AGENT_THINKING_MODEL) {
    return FLIGHT_AGENT_THINKING_MODEL;
  }
  return undefined;
};

/**
 * Flight Agent 模型注入中间件：
 * - 在 wrapModelCall 阶段读取 runtime.context.modelOverride；
 * - 若存在覆盖模型则替换 request.model。
 */
const flightModelInjectionMiddleware = createMiddleware({
  name: "flight-model-injection",
  wrapModelCall: async (request, handler) => {
    const ctx = (request.runtime?.context ?? {}) as {
      modelOverride?: string;
    };
    const override = ctx.modelOverride?.trim();
    if (!override) {
      return handler(request);
    }
    const injectedModel = getChatModel(override);
    return handler({
      ...request,
      model: injectedModel,
    });
  },
});

/**
 * 控制台日志输出长度，避免超长内容刷屏。
 */
const LOG_TEXT_MAX = Number(process.env.LANGCHAIN_LOG_MAX_CHARS ?? "4000");

/**
 * 裁剪日志文本，超长时追加省略标记。
 */
const clipLog = (text: string) =>
  text.length > LOG_TEXT_MAX ? `${text.slice(0, LOG_TEXT_MAX)}...[truncated]` : text;

/**
 * 将历史记忆裁剪成可读预览，供请求日志打印。
 */
const toHistoryPreview = (history: WorkingMemoryTurn[]) =>
  history.map((turn) => ({
    user: clipLog(turn.user),
    tools: (turn.tools ?? []).map((item) => ({
      tool: item.tool,
      result: clipLog(normalizeToolResult(item.result)),
    })),
    assistant: clipLog(turn.assistant),
  }));

/**
 * 将“按轮保存”的会话记忆转换成可直接注入 LLM 的消息序列。
 * 顺序固定为：用户消息 -> 工具结果(0~N条) -> 助手回复。
 * 这样模型能看到一轮完整因果链：用户问题、工具观察、最终回答。
 */
const buildHistoryMessages = (history: WorkingMemoryTurn[]) =>
  history.flatMap((turn) => {
    const toolMessages =
      Array.isArray(turn.tools) && turn.tools.length > 0
        ? turn.tools.map(
            (item) =>
              new AIMessage(
                `[tool:${item.tool}] ${normalizeToolResult(item.result)}`
              )
          )
        : [];
    return [
      new HumanMessage(turn.user),
      ...toolMessages,
      new AIMessage(turn.assistant),
    ];
  });

/**
 * 从 workflow payload 中解析 conversationId。
 * - 优先读取 payload.options；
 * - 再回退读取 payload.input.options；
 * - 缺失时返回 undefined（表示不启用会话记忆）。
 */
const resolveConversationId = (payload: WorkflowPayload): string | undefined => {
  const fromOptions = payload.options?.conversationId;
  if (typeof fromOptions === "string" && fromOptions.trim()) {
    return fromOptions.trim();
  }
  const fromInputOptions = payload.input?.options?.conversationId;
  if (typeof fromInputOptions === "string" && fromInputOptions.trim()) {
    return fromInputOptions.trim();
  }
  return undefined;
};

/**
 * 读取会话的最近记忆消息。
 */
const getWorkingMemory = (conversationId?: string): WorkingMemoryTurn[] => {
  if (!conversationId) return [];
  return workingMemoryStore.get(conversationId) ?? [];
};

/**
 * 规范化工具结果文本：
 * - 统一转字符串；
 * - 超长截断，避免上下文和日志膨胀。
 */
const normalizeToolResult = (value: unknown) => {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (text.length <= WORKING_MEMORY_TOOL_RESULT_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, WORKING_MEMORY_TOOL_RESULT_MAX_CHARS)}...[truncated]`;
};

/**
 * 写入一轮问答到会话记忆，并做轮数裁剪。
 */
const rememberConversationTurn = (
  conversationId: string | undefined,
  userText: string,
  assistantText: string,
  tools?: WorkingMemoryMessage[]
) => {
  if (!conversationId) return;
  const safeUser = userText.trim();
  const safeAssistant = assistantText.trim();
  if (!safeUser || !safeAssistant) return;
  const history = getWorkingMemory(conversationId);
  const safeTools =
    Array.isArray(tools) && tools.length > 0
      ? tools
          .filter((item) => typeof item.tool === "string" && item.tool.trim())
          .map((item) => ({
            tool: item.tool.trim(),
            result: normalizeToolResult(item.result),
          }))
      : undefined;
  const next = [
    ...history,
    {
      user: safeUser,
      assistant: safeAssistant,
      tools: safeTools,
      timestamp: Date.now(),
    },
  ];
  // 使用“轮数”配置，每轮包含 user/assistant 及可选工具结果。
  const maxTurns = Number.isFinite(WORKING_MEMORY_MAX_TURNS)
    ? Math.max(1, WORKING_MEMORY_MAX_TURNS)
    : NaN;
  const maxTurnItems = Number.isFinite(maxTurns) ? maxTurns : 6;
  workingMemoryStore.set(conversationId, next.slice(-maxTurnItems));
};

/**
 * 调用模型生成文本。
 * @param system 系统提示词
 * @param user 用户输入
 * @param options 调用配置（会话记忆开关、日志标签等）
 * @returns 清洗后的文本内容
 */
const invokeText = async (
  system: string,
  user: string,
  options?: InvokeOptions
) => {
  const start = Date.now();
  const memoryMode = options?.memoryMode ?? "off";
  const conversationId = options?.conversationId;
  const history = memoryMode === "off" ? [] : getWorkingMemory(conversationId);
  const historyMessages = buildHistoryMessages(history);
  const logTag = options?.logTag ?? "default";
  const requestLog = {
    tag: logTag,
    model: modelConfig.model,
    baseURL: modelConfig.configuration?.baseURL ?? "default",
    conversationId: conversationId ?? null,
    memoryMode,
    memoryTurns: history.length,
    historyPreview: toHistoryPreview(history),
    system: clipLog(system),
    user: clipLog(user),
  };
  console.log("[langchain:llm:request]", requestLog);
  try {
    const output = await chatModel.invoke([
      new SystemMessage(system),
      ...historyMessages,
      new HumanMessage(user),
    ]);
    const raw =
      typeof output.content === "string"
        ? output.content
        : JSON.stringify(output.content);
    const usage =
      (output as any).usage_metadata ??
      (output as any).response_metadata?.tokenUsage ??
      null;
    console.log("[langchain:llm:response]", {
      tag: logTag,
      durationMs: Date.now() - start,
      conversationId: conversationId ?? null,
      usage,
      content: clipLog(raw),
    });
    if (memoryMode === "read_write") {
      rememberConversationTurn(
        conversationId,
        options?.memoryUserText ?? user,
        raw,
        options?.memoryTools
      );
    }
    return raw.trim();
  } catch (error) {
    console.error("[langchain:llm:error]", {
      tag: logTag,
      durationMs: Date.now() - start,
      conversationId: conversationId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * 从模型文本中提取第一个 JSON 对象。
 * - 支持 markdown 代码块包裹；
 * - 若整段 parse 失败，会尝试截取首尾大括号再解析。
 */
const extractFirstJson = <T>(text: string): T | null => {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // continue
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
};

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
 * - 直接用系统提示词 + 用户问题生成回复文本。
 */
const executeDirectChatWorkflow = async (
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const query = payload.input.query.trim();
  const conversationId = resolveConversationId(payload);
  const text = await invokeText(DEFAULT_SYSTEM_PROMPT, query, {
    conversationId,
    memoryMode: "read_write",
    memoryUserText: query,
    logTag: "direct-chat",
  });
  return { success: true, data: { result: { text } } };
};

/**
 * 基于检索片段做二次总结。
 * - 仅在启用 useLlmSummary 时使用；
 * - 要求模型严格基于给定 references 作答。
 */
const summarizeRagAnswer = async (
  payload: WorkflowPayload,
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
    conversationId: resolveConversationId(payload),
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
      ? await summarizeRagAnswer(payload, query, rag.snippets)
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
  rememberConversationTurn(resolveConversationId(payload), query, text, [
    ragToolResult,
  ]);

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
 * - 当前实现是轻量客服问答；
 * - 返回 replyText，由上层 formatter 统一包装。
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
 * 归一化航班查询参数并做最小校验。
 * - 城市名会转换为 IATA；
 * - 必须包含可用 slices 和 passengers；
 * - 不满足条件时返回 null 让上层提示补充信息。
 */
const normalizeFlightInput = (
  extraction: FlightExtraction
): OfferRequestInput | null => {
  const slices = Array.isArray(extraction.slices)
    ? extraction.slices
        .map((slice) => ({
          origin: resolveIataCode(String(slice.origin ?? "").trim()),
          destination: resolveIataCode(String(slice.destination ?? "").trim()),
          departure_date: String(slice.departure_date ?? "").trim(),
        }))
        .filter(
          (slice) =>
            slice.origin.length >= 3 &&
            slice.destination.length >= 3 &&
            slice.departure_date.length >= 8
        )
    : [];
  const passengers = Array.isArray(extraction.passengers)
    ? extraction.passengers
        .map((passenger) => {
          if (typeof passenger.age === "number") {
            return { age: passenger.age };
          }
          return { type: passenger.type ?? "adult" };
        })
        .filter(
          (passenger) =>
            typeof passenger.age === "number" || Boolean(passenger.type)
        )
    : [{ type: "adult" as const }];
  if (slices.length === 0 || passengers.length === 0) {
    return null;
  }
  return {
    slices,
    passengers,
    cabin_class: extraction.cabin_class,
    max_connections:
      typeof extraction.max_connections === "number"
        ? extraction.max_connections
        : undefined,
    supplier_timeout:
      typeof extraction.supplier_timeout === "number"
        ? extraction.supplier_timeout
        : undefined,
  };
};

/**
 * 工具：将城市/机场名解析成 IATA 三字码。
 */
const resolveIataTool = tool(
  async ({ location }) => ({
    original: location,
    iata: resolveIataCode(location),
  }),
  {
    name: "resolve_iata",
    description:
      "Convert a city/airport name into a 3-letter IATA code. Use this before searching flights when unsure.",
    schema: z.object({
      location: z.string().min(1),
    }),
  }
);

/**
 * 工具：调用 Duffel 查询机票报价。
 * - 输入校验通过后执行检索；
 * - 返回统一结果结构，供 agent 后续推理消费。
 */
const duffelSearchOffersAgentTool = tool(
  async (input) => {
    const normalized = normalizeFlightInput(input as FlightExtraction);
    if (!normalized) {
      return {
        ok: false,
        error:
          "Missing required fields. Provide slices(origin/destination/departure_date) and passengers.",
      };
    }
    const maxOffers =
      typeof (input as FlightExtraction).maxOffers === "number"
        ? (input as FlightExtraction).maxOffers!
        : 10;
    const searchResult = await runDuffelSearchOffers(normalized, maxOffers);
    return {
      ok: true,
      input: normalized,
      offerRequestId: searchResult.offerRequestId,
      offers: searchResult.offers,
      offerCount: searchResult.offers.length,
    };
  },
  {
    name: "duffel_search_offers",
    description:
      "Search flight offers. Requires slices[{origin,destination,departure_date}] and passengers[{type|age}].",
    schema: z.object({
      slices: z
        .array(
          z.object({
            origin: z.string().min(1),
            destination: z.string().min(1),
            departure_date: z.string().min(8),
          })
        )
        .min(1),
      passengers: z
        .array(
          z.object({
            type: z
              .enum(["adult", "child", "infant_without_seat"])
              .optional(),
            age: z.number().int().positive().optional(),
          })
        )
        .min(1),
      cabin_class: z
        .enum(["first", "business", "premium_economy", "economy"])
        .optional(),
      max_connections: z.number().int().min(0).optional(),
      supplier_timeout: z.number().int().positive().optional(),
      maxOffers: z.number().int().min(1).max(50).optional(),
    }),
  }
);

/**
 * Flight Agent（createAgent）执行流程：
 * - 通过 createAgent 挂载工具并执行 ReAct 循环；
 * - 从最终消息里提取最后一条 AI 回复；
 * - 从 tool 消息里回收工具结果，保持与现有返回结构兼容。
 */
const runFlightAgent = async (
  payload: WorkflowPayload
): Promise<FlightAgentRunResult> => {
  const query = payload.input.query.trim();
  const conversationId = resolveConversationId(payload);
  const history = getWorkingMemory(conversationId);
  const historyMessages = buildHistoryMessages(history);
  // Flight Agent 当前可用工具集合。
  const tools = [resolveIataTool, duffelSearchOffersAgentTool];
  const modelOverride = resolveFlightAgentModelOverride(payload);
  // 通过 createAgent 创建 ReAct agent，并挂载模型注入中间件。
  const agent = createAgent({
    model: chatModel,
    tools,
    middleware: [flightModelInjectionMiddleware],
    systemPrompt:
      "You are a flight booking assistant. Use tools when needed. " +
      "If key fields are missing, ask concise follow-up questions in Chinese.",
  });
  const maxSteps = Number.isFinite(FLIGHT_AGENT_MAX_STEPS)
    ? Math.max(1, FLIGHT_AGENT_MAX_STEPS)
    : 4;
  // Agent 输入消息：历史记忆 + 当前用户问题。
  const inputMessages = [
    ...historyMessages,
    new HumanMessage(query),
  ];
  // recursionLimit 用于约束 agent 总体循环深度。
  const result = await agent.invoke(
    { messages: inputMessages as any },
    {
      recursionLimit: maxSteps * 3,
      context: { modelOverride },
    }
  );
  const allMessages = Array.isArray((result as any).messages)
    ? ((result as any).messages as Array<any>)
    : [];
  // 收集本次工具调用结果，写入 working memory。
  const toolRecords: WorkingMemoryMessage[] = [];
  // 保存最后一次有效机票检索结果，用于回包与兜底文案。
  let latestSearch:
    | {
        input: OfferRequestInput;
        offerRequestId: string;
        offers: Array<{ id: string; total_amount: string; total_currency: string }>;
        offerCount: number;
      }
    | null = null;
  for (const message of allMessages) {
    const type =
      typeof message?.getType === "function"
        ? message.getType()
        : message?._getType?.() ?? message?.type;
    if (type !== "tool") continue;
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    const parsed = extractFirstJson<Record<string, unknown>>(content);
    const toolName =
      typeof message?.name === "string" && message.name.trim()
        ? message.name
        : parsed?.offerRequestId
        ? "duffel_search_offers"
        : "agent_tool";
    const toolResult = parsed ?? content;
    toolRecords.push({ tool: toolName, result: toolResult });
    if (
      toolName === "duffel_search_offers" &&
      parsed &&
      parsed.ok === true &&
      Array.isArray(parsed.offers)
    ) {
      latestSearch = {
        input: (parsed.input ?? null) as OfferRequestInput,
        offerRequestId: String(parsed.offerRequestId ?? ""),
        offers: parsed.offers as Array<{
          id: string;
          total_amount: string;
          total_currency: string;
        }>,
        offerCount:
          typeof parsed.offerCount === "number"
            ? parsed.offerCount
            : (parsed.offers as Array<unknown>).length,
      };
    }
  }

  // 最终答案优先取最后一条 AI 消息；为空时使用兜底摘要。
  const lastAi = [...allMessages].reverse().find((message) => {
    const type =
      typeof message?.getType === "function"
        ? message.getType()
        : message?._getType?.() ?? message?.type;
    return type === "ai";
  });
  const finalTextRaw =
    lastAi && typeof lastAi.content === "string"
      ? lastAi.content.trim()
      : lastAi
      ? JSON.stringify(lastAi.content ?? "").trim()
      : "";
  const finalText =
    finalTextRaw ||
    (latestSearch && latestSearch.offerCount > 0
      ? summarizeOffersText(latestSearch.offerCount, latestSearch.offers)
      : "请补充航班信息：出发地、目的地、出发日期（YYYY-MM-DD），以及乘客人数。");

  return {
    replyText: finalText,
    offers: latestSearch?.offers ?? [],
    offerRequestId: latestSearch?.offerRequestId ?? "",
    offerCount: latestSearch?.offerCount ?? 0,
    search: latestSearch?.input ?? null,
    tools: toolRecords,
  };
};

/**
 * 生成简短报价摘要文本。
 * - 默认展示最低的前 3 个报价。
 */
const summarizeOffersText = (
  offerCount: number,
  offers: Array<{ total_amount: string; total_currency: string }>
) => {
  if (offerCount <= 0) {
    return "暂时没有找到可用的机票报价。请尝试调整日期或出发地。";
  }
  const top = offers.slice(0, 3);
  const lines = top.map((offer, index) => {
    const price = [offer.total_amount, offer.total_currency]
      .filter(Boolean)
      .join(" ");
    return `${index + 1}. ${price}`;
  });
  return [`已为你找到 ${offerCount} 个报价，以下是前 3 个：`, ...lines].join("\n");
};

/**
 * 执行 flight-booking-workflow：
 * - 先抽取并校验参数；
 * - 参数完整时调用 Duffel 查询；
 * - 查询失败返回可读错误信息，并保持响应结构稳定。
 */
const executeFlightWorkflow = async (
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const query = payload.input.query.trim();
  const conversationId = resolveConversationId(payload);
  try {
    const agentResult = await runFlightAgent(payload);
    rememberConversationTurn(
      conversationId,
      query,
      agentResult.replyText,
      agentResult.tools
    );
    return {
      success: true,
      data: {
        result: {
          replyText: agentResult.replyText,
          offers: agentResult.offers,
          offerRequestId: agentResult.offerRequestId,
          offerCount: agentResult.offerCount,
          search: agentResult.search,
        },
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Flight workflow failed.";
    const replyText = "航班查询暂时不可用，请稍后重试。";
    rememberConversationTurn(conversationId, query, replyText);
    return {
      success: true,
      data: {
        result: {
          replyText,
          offers: [],
          offerCount: 0,
          reason: message,
        },
      },
    };
  }
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
 * - 按 workflowId 分发到具体执行函数；
 * - 保证与现有 route-service 的 workflow ID 约定一致。
 */
export const executeLangChainWorkflow = async (
  workflowId: string,
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  if (workflowId === "routing-workflow") {
    return executeRoutingWorkflow(payload);
  }
  if (workflowId === "direct-chat-workflow") {
    return executeDirectChatWorkflow(payload);
  }
  if (workflowId === "local-rag-workflow") {
    return executeLocalRagWorkflow(payload);
  }
  if (workflowId === "return-request-workflow") {
    return executeReturnWorkflow(payload);
  }
  if (workflowId === "flight-booking-workflow") {
    return executeFlightWorkflow(payload);
  }
  return executeUnknownWorkflow(workflowId);
};
