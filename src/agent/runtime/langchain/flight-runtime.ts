/*
 * 文件作用：Flight 专用运行时：封装 createAgent、航班工具、checkpointer、progress writer 与 flight 回包解析。
 * 调用链阶段：LangChain 执行阶段（workflow 分发与模型/工具调用）
 * 调用链关系：上游：src/agent/runtime/langchain-executor.ts::executeFlightWorkflowStreamEntry()/WORKFLOW_EXECUTORS；下游：runDuffelSearchOffers()、resolveIataCode()、createAgent().stream()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, RemoveMessage } from "@langchain/core/messages";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { createAgent, createMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import { z } from "zod";
import { resolveIataCode } from "@/agent/airports/airports-index";
import {
  runDuffelSearchOffers,
  type OfferRequestInput,
} from "@/agent/tools/duffel-flight-tool";
import { getRedisClient } from "@/lib/redis";
import { getRedisDb } from "@/lib/redis-url";
import type { WorkflowPayload, WorkflowResponse } from "@/agent/runtime/types";

/**
 * Flight Agent 执行后的统一结果结构。
 */
export type FlightAgentRunResult = {
  replyText: string;
  offers: Array<{ id: string; total_amount: string; total_currency: string }>;
  offerRequestId: string;
  offerCount: number;
  search: OfferRequestInput | null;
  reason?: string;
};

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

type FlightAgentRuntimeContext = {
  modelOverride?: string;
};

type FlightToolProgressStage =
  | "start"
  | "validating_input"
  | "searching_offers"
  | "done"
  | "failed";

export type FlightToolProgressEvent = {
  type: "tool_progress";
  tool: string;
  stage: FlightToolProgressStage;
  message: string;
  meta?: Record<string, unknown>;
};

type FlightProgressCallback = (event: FlightToolProgressEvent) => void;

type FlightSearchSnapshot = {
  input: OfferRequestInput;
  offerRequestId: string;
  offers: Array<{ id: string; total_amount: string; total_currency: string }>;
  offerCount: number;
};

type FlightRuntimeDeps = {
  resolveConversationId: (payload: WorkflowPayload) => string | undefined;
  getChatModel: (modelName?: string) => ChatOpenAI;
  defaultModelName: string;
  extractFirstJson: <T>(text: string) => T | null;
};

const flightConfig = {
  maxSteps: Number(process.env.LANGCHAIN_FLIGHT_AGENT_MAX_STEPS ?? "4"),
  checkpointerMode: (
    process.env.LANGCHAIN_FLIGHT_CHECKPOINTER ?? "memory"
  )
    .trim()
    .toLowerCase(),
  checkpointerRedisDb: getRedisDb(
    process.env.LANGCHAIN_FLIGHT_CHECKPOINTER_REDIS_DB,
    0,
  ),
  checkpointerTtlSeconds: Number(
    process.env.LANGCHAIN_FLIGHT_CHECKPOINTER_TTL_SECONDS ?? "0",
  ),
  checkpointNs:
    process.env.LANGCHAIN_FLIGHT_CHECKPOINT_NS?.trim() || "flights",
  memoryTrimMode: (
    process.env.LANGCHAIN_FLIGHT_MEMORY_TRIM_MODE ?? "turns"
  )
    .trim()
    .toLowerCase(),
  memoryMaxTurns: Number(process.env.LANGCHAIN_FLIGHT_MEMORY_MAX_TURNS ?? "6"),
  memoryMaxTokens: Number(
    process.env.LANGCHAIN_FLIGHT_MEMORY_MAX_TOKENS ?? "4000",
  ),
  modelOverride: process.env.LANGCHAIN_FLIGHT_AGENT_MODEL?.trim(),
  thinkingModelOverride:
    process.env.LANGCHAIN_FLIGHT_AGENT_THINKING_MODEL?.trim(),
};

const getMessageType = (message: any): string => {
  if (typeof message?.getType === "function") return message.getType();
  if (typeof message?._getType === "function") return message._getType();
  return typeof message?.type === "string" ? message.type : "unknown";
};

const getMessageText = (message: any): string => {
  const content = message?.content;
  if (typeof content === "string") return content;
  return JSON.stringify(content ?? "");
};

/**
 * 按“最近 N 轮用户发言（human）”裁剪消息窗口。
 * 处理结果：
 * - 返回一个按原时间顺序排列的新数组；
 * - 数组仅保留“从最近第 N 条 human 消息开始”到末尾的所有消息；
 * - 这样可同时保留该窗口内的 AI/Tool 消息，保证上下文因果链完整。
 *
 * 例子（maxTurns = 2）：
 * 输入顺序：
 * [h1, ai1, tool1, h2, ai2, h3, ai3]
 * 输出顺序：
 * [h2, ai2, h3, ai3]
 * 解释：从尾部回溯到第 2 条 human（h2）为边界，保留 h2 之后所有消息。
 */
const trimMessagesByTurns = (messages: any[], maxTurns: number) => {
  const safeTurns = Number.isFinite(maxTurns) ? Math.max(1, maxTurns) : 6;
  const keptReversed: any[] = [];
  let humanCount = 0;
  let reachedBoundary = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (reachedBoundary) break;
    const message = messages[i];
    keptReversed.push(message);
    if (getMessageType(message) === "human") {
      humanCount += 1;
      if (humanCount >= safeTurns) reachedBoundary = true;
    }
  }
  return keptReversed.reverse();
};

/**
 * 按“近似 token 上限”裁剪消息窗口。
 * 处理结果：
 * - 从最新消息开始向前累计，直到达到 maxTokens（字符长度按约 3 chars/token 估算）；
 * - 返回一个按原时间顺序排列的新数组；
 * - 至少会保留 1 条最新消息（即便该消息本身就很长）。
 *
 * 例子（maxTokens = 10，按 3 chars/token 估算）：
 * 输入顺序（括号内为估算 token）：
 * [m1(4), m2(5), m3(3), m4(2)]
 * 从尾部累加：m4(2) -> m3(3) 总计 5 -> m2(5) 总计 10，继续加 m1 会超限。
 * 输出顺序：
 * [m2, m3, m4]
 */
const trimMessagesByTokens = (messages: any[], maxTokens: number) => {
  const safeMax = Number.isFinite(maxTokens) ? Math.max(200, maxTokens) : 4000;
  const keptReversed: any[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const text = getMessageText(message);
    const estimated = Math.max(1, Math.ceil(text.length / 3));
    if (keptReversed.length > 0 && total + estimated > safeMax) break;
    keptReversed.push(message);
    total += estimated;
  }
  return keptReversed.reverse();
};

/**
 * 归一化 flight 查询参数并做最小可执行校验。
 * 处理结果：
 * - slices: 把 origin/destination 统一转为 IATA（三字码），并过滤掉缺字段或日期格式明显不完整的切片；
 * - passengers: 优先保留 age；无 age 时保留 type（默认 adult）；若未传 passengers，默认补 1 个 adult；
 * - 可选参数（cabin_class/max_connections/supplier_timeout）仅在类型正确时透传；
 * - 当 slices 或 passengers 为空时返回 null，表示“参数不完整，不能执行航班检索”。
 *
 * 例子：
 * 输入：
 * {
 *   slices: [{ origin: "上海", destination: "东京", departure_date: "2026-04-20" }],
 *   passengers: [{}],
 *   max_connections: 1
 * }
 * 输出（示意）：
 * {
 *   slices: [{ origin: "PVG", destination: "TYO", departure_date: "2026-04-20" }],
 *   passengers: [{ type: "adult" }],
 *   max_connections: 1
 * }
 * 如果 origin/destination 无法解析且过滤后 slices 为空，则返回 null。
 */
const normalizeFlightInput = (
  extraction: FlightExtraction,
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
            slice.departure_date.length >= 8,
        )
    : [];
  const passengers = Array.isArray(extraction.passengers)
    ? extraction.passengers
        .map((passenger) => {
          if (typeof passenger.age === "number") return { age: passenger.age };
          return { type: passenger.type ?? "adult" };
        })
        .filter(
          (passenger) =>
            typeof passenger.age === "number" || Boolean(passenger.type),
        )
    : [{ type: "adult" as const }];
  if (slices.length === 0 || passengers.length === 0) return null;
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

const emitFlightToolProgress = (
  runtime: ToolRuntime | undefined,
  payload: FlightToolProgressEvent,
) => {
  const writer = runtime?.writer;
  if (typeof writer !== "function") return;
  writer(payload);
};

const isFlightToolProgressEvent = (
  value: unknown,
): value is FlightToolProgressEvent => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "tool_progress" &&
    typeof record.tool === "string" &&
    typeof record.stage === "string" &&
    typeof record.message === "string"
  );
};

const reportFlightToolStage = (
  runtime: ToolRuntime | undefined,
  toolName: FlightToolProgressEvent["tool"],
  stage: FlightToolProgressStage,
  message: string,
  meta?: Record<string, unknown>,
) => {
  emitFlightToolProgress(runtime, {
    type: "tool_progress",
    tool: toolName,
    stage,
    message,
    meta,
  });
};

const summarizeOffersText = (
  offerCount: number,
  offers: Array<{ total_amount: string; total_currency: string }>,
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
  return [`已为你找到 ${offerCount} 个报价，以下是前 3 个：`, ...lines].join(
    "\n",
  );
};

const flightAgentResponseFormat = z.object({
  replyText: z.string(),
  offers: z
    .array(
      z.object({
        id: z.string(),
        total_amount: z.string(),
        total_currency: z.string(),
      }),
    )
    .default([]),
  offerRequestId: z.string().default(""),
  offerCount: z.number().int().min(0).default(0),
  search: z
    .object({
      slices: z
        .array(
          z.object({
            origin: z.string(),
            destination: z.string(),
            departure_date: z.string(),
          }),
        )
        .min(1),
      passengers: z
        .array(
          z.object({
            type: z.enum(["adult", "child", "infant_without_seat"]).optional(),
            age: z.number().int().positive().optional(),
          }),
        )
        .min(1),
      cabin_class: z
        .enum(["first", "business", "premium_economy", "economy"])
        .optional(),
      max_connections: z.number().int().min(0).optional(),
      supplier_timeout: z.number().int().positive().optional(),
    })
    .nullable()
    .default(null),
  reason: z.string().optional(),
});

type FlightAgentStructuredResponseData = z.infer<typeof flightAgentResponseFormat>;

const extractLatestFlightSearch = (
  messages: Array<any>,
  extractFirstJson: <T>(text: string) => T | null,
): FlightSearchSnapshot | null => {
  let latestSearch: FlightSearchSnapshot | null = null;
  for (const message of messages) {
    if (getMessageType(message) !== "tool") continue;
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    const parsed = extractFirstJson<Record<string, unknown>>(content);
    const toolName = typeof message?.name === "string" ? message.name.trim() : "";
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
  return latestSearch;
};

const extractLastAiText = (messages: Array<any>) => {
  const lastAi = [...messages]
    .reverse()
    .find((message) => getMessageType(message) === "ai");
  if (!lastAi) return "";
  return typeof lastAi.content === "string"
    ? lastAi.content.trim()
    : JSON.stringify(lastAi.content ?? "").trim();
};

const buildFlightFallbackText = (latestSearch: FlightSearchSnapshot | null) =>
  latestSearch && latestSearch.offerCount > 0
    ? summarizeOffersText(latestSearch.offerCount, latestSearch.offers)
    : "请补充航班信息：出发地、目的地、出发日期（YYYY-MM-DD），以及乘客人数。";

const buildFlightAgentRunResult = (
  result: Record<string, unknown>,
  extractFirstJson: <T>(text: string) => T | null,
): FlightAgentRunResult => {
  const allMessages = Array.isArray((result as any).messages)
    ? ((result as any).messages as Array<any>)
    : [];
  const structured = (result as any).structuredResponse as
    | FlightAgentStructuredResponseData
    | undefined;
  const latestSearch = extractLatestFlightSearch(allMessages, extractFirstJson);
  const finalTextRaw = extractLastAiText(allMessages);
  const finalText = finalTextRaw || buildFlightFallbackText(latestSearch);
  const parsedStructured = flightAgentResponseFormat.safeParse(structured ?? {});
  if (parsedStructured.success) {
    const data = parsedStructured.data;
    const normalizedOfferCount =
      typeof data.offerCount === "number" && Number.isFinite(data.offerCount)
        ? data.offerCount
        : data.offers.length;
    return {
      replyText: data.replyText?.trim() || finalText,
      offers: data.offers,
      offerRequestId: data.offerRequestId ?? "",
      offerCount: normalizedOfferCount,
      search: (data.search as OfferRequestInput | null) ?? null,
      reason: data.reason,
    };
  }
  return {
    replyText: finalText,
    offers: latestSearch?.offers ?? [],
    offerRequestId: latestSearch?.offerRequestId ?? "",
    offerCount: latestSearch?.offerCount ?? 0,
    search: latestSearch?.input ?? null,
  };
};

const createFlightTools = () => {
  const resolveIataTool = tool(
    async ({ location }, runtime?: ToolRuntime) => {
      reportFlightToolStage(runtime, "resolve_iata", "start", `正在解析地点：${location}`);
      const iata = resolveIataCode(location);
      reportFlightToolStage(
        runtime,
        "resolve_iata",
        "done",
        `地点解析完成：${location} -> ${iata}`,
        { original: location, iata },
      );
      return { original: location, iata };
    },
    {
      name: "resolve_iata",
      description:
        "Convert a city/airport name into a 3-letter IATA code. Use this before searching flights when unsure.",
      schema: z.object({
        location: z.string().min(1),
      }),
    },
  );

  const duffelSearchOffersAgentTool = tool(
    async (input, runtime?: ToolRuntime) => {
      reportFlightToolStage(
        runtime,
        "duffel_search_offers",
        "start",
        "开始处理航班查询请求",
      );
      reportFlightToolStage(
        runtime,
        "duffel_search_offers",
        "validating_input",
        "正在校验并归一化查询参数",
      );
      const normalized = normalizeFlightInput(input as FlightExtraction);
      if (!normalized) {
        reportFlightToolStage(
          runtime,
          "duffel_search_offers",
          "failed",
          "参数不完整，缺少必要航班查询字段",
        );
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
      reportFlightToolStage(
        runtime,
        "duffel_search_offers",
        "searching_offers",
        "正在向航司供应商查询报价",
        { maxOffers },
      );
      try {
        const searchResult = await runDuffelSearchOffers(normalized, maxOffers);
        reportFlightToolStage(
          runtime,
          "duffel_search_offers",
          "done",
          `报价查询完成，共 ${searchResult.offers.length} 条`,
          {
            offerRequestId: searchResult.offerRequestId,
            offerCount: searchResult.offers.length,
          },
        );
        return {
          ok: true,
          input: normalized,
          offerRequestId: searchResult.offerRequestId,
          offers: searchResult.offers,
          offerCount: searchResult.offers.length,
        };
      } catch (error) {
        reportFlightToolStage(
          runtime,
          "duffel_search_offers",
          "failed",
          "航班报价查询失败",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }
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
            }),
          )
          .min(1),
        passengers: z
          .array(
            z.object({
              type: z
                .enum(["adult", "child", "infant_without_seat"])
                .optional(),
              age: z.number().int().positive().optional(),
            }),
          )
          .min(1),
        cabin_class: z
          .enum(["first", "business", "premium_economy", "economy"])
          .optional(),
        max_connections: z.number().int().min(0).optional(),
        supplier_timeout: z.number().int().positive().optional(),
        maxOffers: z.number().int().min(1).max(50).optional(),
      }),
    },
  );

  return [resolveIataTool, duffelSearchOffersAgentTool] as const;
};

export const createFlightRuntime = (deps: FlightRuntimeDeps) => {
  const {
    resolveConversationId,
    getChatModel,
    defaultModelName,
    extractFirstJson,
  } = deps;
  const [resolveIataTool, duffelSearchOffersAgentTool] = createFlightTools();

  /**
   * 模型注入中间件：根据 runtime.context.modelOverride 动态替换本次调用模型。
   * 处理结果：
   * - 有 override：本次模型调用改用 getChatModel(override)；
   * - 无 override：保持默认模型不变。
   *
   * 例子：
   * 输入 context.modelOverride = "qwen3.5-plus"
   * 输出行为：本次 flight agent 推理走 qwen3.5-plus，而非 defaultModelName。
   */
  const flightModelInjectionMiddleware = createMiddleware({
    name: "flight-model-injection",
    wrapModelCall: async (request, handler) => {
      const ctx = (request.runtime?.context ?? {}) as FlightAgentRuntimeContext;
      const override = ctx.modelOverride?.trim();
      if (!override) return handler(request);
      const injectedModel = getChatModel(override);
      return handler({
        ...request,
        model: injectedModel,
      });
    },
  });

  /**
   * 消息裁剪中间件（官方 beforeModel 范式）：在状态层替换 messages。
   * 处理结果：
   * - 若裁剪后长度未减少：不返回更新（保持原状态）；
   * - 若裁剪后长度减少：先发 REMOVE_ALL_MESSAGES，再写入 trimmed，完成整段替换。
   *
   * 例子（turns 模式）：
   * 原 messages = [h1, ai1, h2, ai2, h3, ai3]，maxTurns=2
   * 裁剪后 trimmed = [h2, ai2, h3, ai3]
   * 返回更新 = [RemoveAll, h2, ai2, h3, ai3]
   */
  const flightMemoryTrimMiddleware = createMiddleware({
    name: "flight-memory-trim",
    beforeModel: (state: Record<string, unknown>) => {
      const rawMessages = Array.isArray(state.messages) ? state.messages : [];
      const trimmed =
        flightConfig.memoryTrimMode === "tokens"
          ? trimMessagesByTokens(rawMessages as any[], flightConfig.memoryMaxTokens)
          : trimMessagesByTurns(rawMessages as any[], flightConfig.memoryMaxTurns);
      if (trimmed.length >= rawMessages.length) {
        return;
      }
      return {
        messages: [
          new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
          ...(trimmed as any[]),
        ],
      };
    },
  });

  /**
   * 解析本次 flight 请求模型覆盖值。
   * 处理结果优先级：
   * 1) LANGCHAIN_FLIGHT_AGENT_MODEL；
   * 2) enableThinking=true 且配置了 LANGCHAIN_FLIGHT_AGENT_THINKING_MODEL；
   * 3) undefined（使用默认模型）。
   *
   * 例子：
   * enableThinking=true，THINKING_MODEL=qwen-max
   * 返回 "qwen-max"；若未配置则返回 undefined。
   */
  const resolveFlightAgentModelOverride = (payload: WorkflowPayload) => {
    if (flightConfig.modelOverride) return flightConfig.modelOverride;
    const enableThinking = payload.input.options?.enableThinking;
    if (enableThinking && flightConfig.thinkingModelOverride) {
      return flightConfig.thinkingModelOverride;
    }
    return undefined;
  };

  const flightAgentCheckpointer = new MemorySaver();
  let flightAgentPromise: Promise<ReturnType<typeof createAgent>> | null = null;

  /**
   * 解析并创建 checkpointer（memory/redis 开关）。
   * 处理结果：
   * - mode=memory：返回进程内 MemorySaver；
   * - mode=redis 且可连接：返回 RedisSaver；
   * - mode=redis 但连接失败：告警后回退 MemorySaver。
   *
   * 例子：
   * LANGCHAIN_FLIGHT_CHECKPOINTER=redis 且 Redis 不可用 -> 返回 MemorySaver。
   */
  const resolveFlightCheckpointer = async () => {
    if (flightConfig.checkpointerMode !== "redis") {
      return flightAgentCheckpointer;
    }
    const client = await getRedisClient(flightConfig.checkpointerRedisDb);
    if (!client) {
      console.warn(
        "[flights] redis checkpointer unavailable, fallback to MemorySaver",
      );
      return flightAgentCheckpointer;
    }
    const ttlConfig =
      flightConfig.checkpointerTtlSeconds > 0
        ? {
            defaultTTL: flightConfig.checkpointerTtlSeconds,
            refreshOnRead: true,
          }
        : undefined;
    return new RedisSaver(client as any, ttlConfig);
  };

  /**
   * 获取（惰性初始化）flight agent 单例。
   * 处理结果：
   * - 首次调用：创建 agent（模型、工具、中间件、checkpointer、responseFormat）；
   * - 后续调用：复用同一实例，避免重复初始化。
   *
   * 例子：
   * 第一次请求会执行 createAgent(...)；第二次请求直接返回缓存实例。
   */
  const getFlightAgent = async () => {
    if (!flightAgentPromise) {
      flightAgentPromise = (async () => {
        const checkpointer = await resolveFlightCheckpointer();
        return createAgent({
          model: getChatModel(defaultModelName),
          tools: [resolveIataTool, duffelSearchOffersAgentTool],
          middleware: [
            flightMemoryTrimMiddleware,
            flightModelInjectionMiddleware,
          ],
          checkpointer,
          responseFormat: flightAgentResponseFormat,
          systemPrompt:
            "You are a flight booking assistant. Use tools when needed. " +
            "If key fields are missing, ask concise follow-up questions in Chinese. " +
            "Always return final result strictly following response schema.",
        });
      })();
    }
    return flightAgentPromise;
  };

  /**
   * 运行 flight agent 并归一化最终业务结果。
   * 处理结果：
   * 1) 通过 streamMode=["custom","values"] 收集进度与最终状态；
   * 2) 优先读取 structuredResponse（responseFormat），失败时回退消息扫描；
   * 3) 返回统一结构 FlightAgentRunResult，供 workflow 层直接回包。
   *
   * 例子：
   * 输入 query="帮我查上海到东京 2026-04-20 两位成人"
   * 输出 { replyText, offers, offerRequestId, offerCount, search }。
   * 若模型未产出结构化结果，则根据 tool 消息扫描生成同结构兜底结果。
   */
  const runFlightAgent = async (
    payload: WorkflowPayload,
    onProgress?: FlightProgressCallback,
  ): Promise<FlightAgentRunResult> => {
    const query = payload.input.query.trim();
    const conversationId = resolveConversationId(payload);
    const modelOverride = resolveFlightAgentModelOverride(payload);
    const maxSteps = Number.isFinite(flightConfig.maxSteps)
      ? Math.max(1, flightConfig.maxSteps)
      : 4;
    const inputMessages = [new HumanMessage(query)];
    const threadId =
      conversationId ||
      payload.options?.userId ||
      payload.input.options?.userId ||
      "flight-anon";
    const flightAgent = await getFlightAgent();
    const stream = await flightAgent.stream(
      { messages: inputMessages as any },
      {
        recursionLimit: maxSteps * 3,
        streamMode: ["custom", "values"],
        configurable: {
          thread_id: threadId,
          checkpoint_ns: flightConfig.checkpointNs,
        },
        context: { modelOverride } as FlightAgentRuntimeContext,
      },
    );
    let latestState: Record<string, unknown> | null = null;
    const captureLatestState = (value: unknown) => {
      if (value && typeof value === "object") {
        latestState = value as Record<string, unknown>;
      }
    };
    const tryHandleStreamChunk = (chunk: unknown) => {
      if (!Array.isArray(chunk)) return;
      const [first, second, third] = chunk;
      if (first === "custom" && isFlightToolProgressEvent(second)) {
        onProgress?.(second);
        return;
      }
      if (first === "values") {
        captureLatestState(second);
        return;
      }
      if (second === "custom" && isFlightToolProgressEvent(third)) {
        onProgress?.(third);
        return;
      }
      if (second === "values") {
        captureLatestState(third);
      }
    };
    for await (const chunk of stream as AsyncIterable<unknown>) {
      tryHandleStreamChunk(chunk);
    }
    return buildFlightAgentRunResult(latestState ?? {}, extractFirstJson);
  };

  /**
   * workflow 级封装：对外提供稳定 Flight workflow 响应。
   * 处理结果：
   * - runFlightAgent 成功：返回 success=true + 标准 result；
   * - runFlightAgent 异常：返回 success=true + 友好失败文案 + reason。
   *
   * 例子：
   * 正常返回：{ replyText, offers, offerCount, offerRequestId, search }
   * 异常返回：{ replyText:\"航班查询暂时不可用...\", offers:[], offerCount:0, reason }。
   */
  const executeFlightWorkflow = async (
    payload: WorkflowPayload,
  ): Promise<WorkflowResponse> => {
    try {
      const agentResult = await runFlightAgent(payload);
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

  return {
    runFlightAgent,
    executeFlightWorkflow,
  };
};
