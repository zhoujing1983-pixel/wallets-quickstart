/*
 * 文件作用：Flight 专用运行时：封装 createAgent、航班工具、checkpointer、progress writer 与 flight 回包解析。
 * 调用链阶段：LangChain 执行阶段（workflow 分发与模型/工具调用）
 * 调用链关系：上游：src/agent/runtime/langchain-executor.ts::executeFlightWorkflowStreamEntry()/WORKFLOW_EXECUTORS；下游：runDuffelSearchOffers()、resolveIataCode()、createAgent().stream()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { createAgent, createMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";
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

type FlightAgentStructuredResponse = {
  replyText: string;
  offers: Array<{ id: string; total_amount: string; total_currency: string }>;
  offerRequestId: string;
  offerCount: number;
  search: OfferRequestInput | null;
  reason?: string;
};

type FlightRuntimeDeps = {
  resolveConversationId: (payload: WorkflowPayload) => string | undefined;
  getChatModel: (modelName?: string) => ChatOpenAI;
  defaultModelName: string;
  extractFirstJson: <T>(text: string) => T | null;
};

// Flight Agent 最大循环步数配置。
const FLIGHT_AGENT_MAX_STEPS = Number(
  process.env.LANGCHAIN_FLIGHT_AGENT_MAX_STEPS ?? "4",
);
// Flight Agent checkpointer 类型：memory（默认）| redis。
const FLIGHT_CHECKPOINTER_MODE = (
  process.env.LANGCHAIN_FLIGHT_CHECKPOINTER ?? "memory"
)
  .trim()
  .toLowerCase();
// Redis checkpointer 使用的 DB（未配置时沿用 REDIS_URL 中默认 DB）。
const FLIGHT_CHECKPOINTER_REDIS_DB = getRedisDb(
  process.env.LANGCHAIN_FLIGHT_CHECKPOINTER_REDIS_DB,
  0,
);
// Redis checkpointer 可选 TTL（秒），<=0 表示不设置 TTL。
const FLIGHT_CHECKPOINTER_TTL_SECONDS = Number(
  process.env.LANGCHAIN_FLIGHT_CHECKPOINTER_TTL_SECONDS ?? "0",
);
// Flight Agent 的 checkpoint namespace，用于隔离不同业务流的 checkpoint。
const FLIGHT_CHECKPOINT_NS =
  process.env.LANGCHAIN_FLIGHT_CHECKPOINT_NS?.trim() || "flights";
// Flight Agent 上下文裁剪模式：turns（按轮）或 tokens（按 token 近似）。
const FLIGHT_MEMORY_TRIM_MODE = (
  process.env.LANGCHAIN_FLIGHT_MEMORY_TRIM_MODE ?? "turns"
)
  .trim()
  .toLowerCase();
// Flight Agent 按轮裁剪时，保留最近 N 轮（按 human 消息计数）。
const FLIGHT_MEMORY_MAX_TURNS = Number(
  process.env.LANGCHAIN_FLIGHT_MEMORY_MAX_TURNS ?? "6",
);
// Flight Agent 按 token 裁剪时，保留最近消息的 token 近似上限。
const FLIGHT_MEMORY_MAX_TOKENS = Number(
  process.env.LANGCHAIN_FLIGHT_MEMORY_MAX_TOKENS ?? "4000",
);
// Flight Agent 固定模型覆盖（最高优先级）。
const FLIGHT_AGENT_MODEL = process.env.LANGCHAIN_FLIGHT_AGENT_MODEL?.trim();
// Flight Agent 在启用 thinking 时的模型覆盖。
const FLIGHT_AGENT_THINKING_MODEL =
  process.env.LANGCHAIN_FLIGHT_AGENT_THINKING_MODEL?.trim();

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

export const createFlightRuntime = (deps: FlightRuntimeDeps) => {
  const {
    resolveConversationId,
    getChatModel,
    defaultModelName,
    extractFirstJson,
  } = deps;

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

  const flightMemoryTrimMiddleware = createMiddleware({
    name: "flight-memory-trim",
    wrapModelCall: async (request, handler) => {
      const rawMessages = Array.isArray(request.messages)
        ? request.messages
        : [];
      const trimmed =
        FLIGHT_MEMORY_TRIM_MODE === "tokens"
          ? trimMessagesByTokens(rawMessages as any[], FLIGHT_MEMORY_MAX_TOKENS)
          : trimMessagesByTurns(rawMessages as any[], FLIGHT_MEMORY_MAX_TURNS);
      return handler({
        ...request,
        messages: trimmed as any,
      });
    },
  });

  const resolveFlightAgentModelOverride = (payload: WorkflowPayload) => {
    if (FLIGHT_AGENT_MODEL) return FLIGHT_AGENT_MODEL;
    const enableThinking = payload.input.options?.enableThinking;
    if (enableThinking && FLIGHT_AGENT_THINKING_MODEL) {
      return FLIGHT_AGENT_THINKING_MODEL;
    }
    return undefined;
  };

  const resolveIataTool = tool(
    async ({ location }, runtime?: ToolRuntime) => {
      emitFlightToolProgress(runtime, {
        type: "tool_progress",
        tool: "resolve_iata",
        stage: "start",
        message: `正在解析地点：${location}`,
      });
      const iata = resolveIataCode(location);
      emitFlightToolProgress(runtime, {
        type: "tool_progress",
        tool: "resolve_iata",
        stage: "done",
        message: `地点解析完成：${location} -> ${iata}`,
        meta: { original: location, iata },
      });
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
      emitFlightToolProgress(runtime, {
        type: "tool_progress",
        tool: "duffel_search_offers",
        stage: "start",
        message: "开始处理航班查询请求",
      });
      emitFlightToolProgress(runtime, {
        type: "tool_progress",
        tool: "duffel_search_offers",
        stage: "validating_input",
        message: "正在校验并归一化查询参数",
      });
      const normalized = normalizeFlightInput(input as FlightExtraction);
      if (!normalized) {
        emitFlightToolProgress(runtime, {
          type: "tool_progress",
          tool: "duffel_search_offers",
          stage: "failed",
          message: "参数不完整，缺少必要航班查询字段",
        });
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
      emitFlightToolProgress(runtime, {
        type: "tool_progress",
        tool: "duffel_search_offers",
        stage: "searching_offers",
        message: "正在向航司供应商查询报价",
        meta: { maxOffers },
      });
      try {
        const searchResult = await runDuffelSearchOffers(normalized, maxOffers);
        emitFlightToolProgress(runtime, {
          type: "tool_progress",
          tool: "duffel_search_offers",
          stage: "done",
          message: `报价查询完成，共 ${searchResult.offers.length} 条`,
          meta: {
            offerRequestId: searchResult.offerRequestId,
            offerCount: searchResult.offers.length,
          },
        });
        return {
          ok: true,
          input: normalized,
          offerRequestId: searchResult.offerRequestId,
          offers: searchResult.offers,
          offerCount: searchResult.offers.length,
        };
      } catch (error) {
        emitFlightToolProgress(runtime, {
          type: "tool_progress",
          tool: "duffel_search_offers",
          stage: "failed",
          message: "航班报价查询失败",
          meta: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
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

  const flightAgentCheckpointer = new MemorySaver();
  let flightAgentPromise: Promise<ReturnType<typeof createAgent>> | null = null;

  const resolveFlightCheckpointer = async () => {
    if (FLIGHT_CHECKPOINTER_MODE !== "redis") {
      return flightAgentCheckpointer;
    }
    const client = await getRedisClient(FLIGHT_CHECKPOINTER_REDIS_DB);
    if (!client) {
      console.warn(
        "[flights] redis checkpointer unavailable, fallback to MemorySaver",
      );
      return flightAgentCheckpointer;
    }
    const ttlConfig =
      FLIGHT_CHECKPOINTER_TTL_SECONDS > 0
        ? {
            defaultTTL: FLIGHT_CHECKPOINTER_TTL_SECONDS,
            refreshOnRead: true,
          }
        : undefined;
    return new RedisSaver(client as any, ttlConfig);
  };

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

  const runFlightAgent = async (
    payload: WorkflowPayload,
    onProgress?: FlightProgressCallback,
  ): Promise<FlightAgentRunResult> => {
    const query = payload.input.query.trim();
    const conversationId = resolveConversationId(payload);
    const modelOverride = resolveFlightAgentModelOverride(payload);
    const maxSteps = Number.isFinite(FLIGHT_AGENT_MAX_STEPS)
      ? Math.max(1, FLIGHT_AGENT_MAX_STEPS)
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
          checkpoint_ns: FLIGHT_CHECKPOINT_NS,
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

    const result = latestState ?? {};
    const allMessages = Array.isArray((result as any).messages)
      ? ((result as any).messages as Array<any>)
      : [];
    const structured = (result as any).structuredResponse as
      | FlightAgentStructuredResponse
      | undefined;
    let latestSearch: {
      input: OfferRequestInput;
      offerRequestId: string;
      offers: Array<{
        id: string;
        total_amount: string;
        total_currency: string;
      }>;
      offerCount: number;
    } | null = null;
    for (const message of allMessages) {
      if (getMessageType(message) !== "tool") continue;
      const content =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content ?? "");
      const parsed = extractFirstJson<Record<string, unknown>>(content);
      const toolName =
        typeof message?.name === "string" ? message.name.trim() : "";
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

    const lastAi = [...allMessages]
      .reverse()
      .find((message) => getMessageType(message) === "ai");
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

    const parsedStructured = flightAgentResponseFormat.safeParse(
      structured ?? {},
    );
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