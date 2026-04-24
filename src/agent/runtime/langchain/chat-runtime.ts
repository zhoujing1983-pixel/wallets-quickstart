/*
 * 文件作用：LangChain 通用会话运行时：封装模型调用、working memory、conversationId 解析、usage 日志与 JSON 提取。
 * 调用链阶段：LangChain 执行阶段（workflow 分发与模型/工具调用）
 * 调用链关系：上游：src/agent/runtime/langchain-executor.ts::execute*Workflow()；下游：ChatOpenAI::invoke()/stream()（经 getChatModel()）与 rememberConversationTurn() 记忆写入。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { WorkflowPayload } from "@/agent/runtime/types";

/**
 * 记忆里的工具结果结构：
 * - tool: 工具名；
 * - result: 工具输出（字符串或对象）。
 */
export type WorkingMemoryMessage = {
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

export type InvokeStreamOptions = InvokeOptions & {
  onDelta?: (delta: string) => void;
};

type LlmInvokeContext = {
  start: number;
  memoryMode: MemoryMode;
  conversationId?: string;
  history: WorkingMemoryTurn[];
  historyMessages: Array<HumanMessage | AIMessage>;
  logTag: string;
  modelName: string;
  requestLog: Record<string, unknown>;
};

// LangChain 模式默认系统提示词，优先支持环境变量覆盖。
export const DEFAULT_SYSTEM_PROMPT =
  process.env.LANGCHAIN_SYSTEM_PROMPT?.trim() ||
  process.env.VOLTAGENT_INSTRUCTIONS?.trim() ||
  "You are a Web3 payments assistant. Keep responses brief.";

// 瞬时记忆保留轮数（每轮含 user/assistant/可选工具结果）。
const WORKING_MEMORY_MAX_TURNS = Number(
  process.env.LANGCHAIN_WORKING_MEMORY_MAX_TURNS ?? "6",
);

// 工具结果写入记忆时的长度上限，避免上下文被大段 JSON 撑爆。
const WORKING_MEMORY_TOOL_RESULT_MAX_CHARS = Number(
  process.env.LANGCHAIN_WORKING_MEMORY_TOOL_RESULT_MAX_CHARS ?? "1200",
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
      configuration: {
        baseURL: process.env.LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1",
      },
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

// 模块加载时初始化一次并在当前进程内复用（与是否 export 无关）。
export const modelConfig = pickModelConfig();
// 按模型名缓存 ChatOpenAI 实例，降低高并发下重复构造成本。
const chatModelCache = new Map<string, ChatOpenAI>();

/**
 * 获取（或创建）指定模型名对应的 ChatOpenAI 实例。
 */
export const getChatModel = (modelName?: string) => {
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

/**
 * 控制台日志输出长度，避免超长内容刷屏。
 */
const LOG_TEXT_MAX = Number(process.env.LANGCHAIN_LOG_MAX_CHARS ?? "4000");

/**
 * 裁剪日志文本，超长时追加省略标记。
 */
const clipLog = (text: string) =>
  text.length > LOG_TEXT_MAX
    ? `${text.slice(0, LOG_TEXT_MAX)}...[truncated]`
    : text;

type TokenUsageLog = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  source: "provider" | "estimated";
  raw?: unknown;
};

const estimateTokens = (text: string) =>
  Math.max(1, Math.ceil(text.length / 3));

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * 兼容不同 provider 的 usage 字段命名，统一抽取 token 用量。
 */
const extractTokenUsage = (output: any): TokenUsageLog => {
  const candidates = [
    output?.usage_metadata,
    output?.response_metadata?.tokenUsage,
    output?.response_metadata?.usage,
    output?.response_metadata?.usage_metadata,
    output?.additional_kwargs?.usage,
  ].filter(Boolean);

  for (const usage of candidates) {
    const inputTokens =
      toNumber((usage as any)?.input_tokens) ??
      toNumber((usage as any)?.prompt_tokens) ??
      toNumber((usage as any)?.inputTokens) ??
      toNumber((usage as any)?.promptTokens);
    const outputTokens =
      toNumber((usage as any)?.output_tokens) ??
      toNumber((usage as any)?.completion_tokens) ??
      toNumber((usage as any)?.outputTokens) ??
      toNumber((usage as any)?.completionTokens);
    const totalTokens =
      toNumber((usage as any)?.total_tokens) ??
      toNumber((usage as any)?.totalTokens) ??
      (inputTokens !== null || outputTokens !== null
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : null);
    if (inputTokens !== null || outputTokens !== null || totalTokens !== null) {
      return {
        inputTokens,
        outputTokens,
        totalTokens,
        source: "provider",
        raw: usage,
      };
    }
  }

  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    source: "provider",
    raw: null,
  };
};

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
 */
const buildHistoryMessages = (history: WorkingMemoryTurn[]) =>
  history.flatMap((turn) => {
    const toolMessages =
      Array.isArray(turn.tools) && turn.tools.length > 0
        ? turn.tools.map(
            (item) =>
              new AIMessage(
                `[tool:${item.tool}] ${normalizeToolResult(item.result)}`,
              ),
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
 */
export const resolveConversationId = (
  payload: WorkflowPayload,
): string | undefined => {
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
 * 解析“是否启用回答流式输出”的开关。
 */
export const resolveStreamAnswerEnabled = (payload: WorkflowPayload) => {
  const option = payload.input?.options?.streamAnswer;
  if (typeof option === "boolean") return option;
  return true;
};

/**
 * 读取会话的最近记忆消息。
 */
const getWorkingMemory = (conversationId?: string): WorkingMemoryTurn[] => {
  if (!conversationId) return [];
  return workingMemoryStore.get(conversationId) ?? [];
};

/**
 * 规范化工具结果文本。
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
export const rememberConversationTurn = (
  conversationId: string | undefined,
  userText: string,
  assistantText: string,
  tools?: WorkingMemoryMessage[],
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
  const maxTurns = Number.isFinite(WORKING_MEMORY_MAX_TURNS)
    ? Math.max(1, WORKING_MEMORY_MAX_TURNS)
    : NaN;
  const maxTurnItems = Number.isFinite(maxTurns) ? maxTurns : 6;
  workingMemoryStore.set(conversationId, next.slice(-maxTurnItems));
};

/**
 * 从模型分片内容中提取可展示文本。
 */
const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (
      block &&
      typeof block === "object" &&
      "text" in block &&
      typeof (block as Record<string, unknown>).text === "string"
    ) {
      parts.push((block as Record<string, unknown>).text as string);
    }
  }
  return parts.join("");
};

/**
 * 构建一次 LLM 调用所需的公共上下文（记忆、日志、模型信息）。
 */
const buildLlmInvokeContext = (
  system: string,
  user: string,
  options: InvokeOptions | undefined,
  defaultTag: string,
): LlmInvokeContext => {
  const start = Date.now();
  const memoryMode = options?.memoryMode ?? "off";
  const conversationId = options?.conversationId;
  const history = memoryMode === "off" ? [] : getWorkingMemory(conversationId);
  const historyMessages = buildHistoryMessages(history);
  const logTag = options?.logTag ?? defaultTag;
  const modelName = modelConfig.model;
  return {
    start,
    memoryMode,
    conversationId,
    history,
    historyMessages,
    logTag,
    modelName,
    requestLog: {
      tag: logTag,
      model: modelName,
      baseURL: modelConfig.configuration?.baseURL ?? "default",
      conversationId: conversationId ?? null,
      memoryMode,
      memoryTurns: history.length,
      historyPreview: toHistoryPreview(history),
      system: clipLog(system),
      user: clipLog(user),
    },
  };
};

/**
 * 调用模型生成文本。
 */
export const invokeText = async (
  system: string,
  user: string,
  options?: InvokeOptions,
) => {
  const ctx = buildLlmInvokeContext(system, user, options, "default");
  console.log("[langchain:llm:request]", ctx.requestLog);
  try {
    const model = getChatModel(ctx.modelName);
    const output = await model.invoke([
      new SystemMessage(system),
      ...ctx.historyMessages,
      new HumanMessage(user),
    ]);
    const raw =
      typeof output.content === "string"
        ? output.content
        : JSON.stringify(output.content);
    const usage = extractTokenUsage(output as any);
    const inputEstimate = estimateTokens(
      [
        system,
        ...ctx.historyMessages.map((msg: any) =>
          extractTextFromContent(msg?.content),
        ),
        user,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const outputEstimate = estimateTokens(raw);
    const fallbackUsage: TokenUsageLog = {
      inputTokens: inputEstimate,
      outputTokens: outputEstimate,
      totalTokens: inputEstimate + outputEstimate,
      source: "estimated",
    };
    const normalizedUsage =
      usage.inputTokens !== null ||
      usage.outputTokens !== null ||
      usage.totalTokens !== null
        ? usage
        : fallbackUsage;
    console.log("[langchain:llm:response]", {
      tag: ctx.logTag,
      durationMs: Date.now() - ctx.start,
      conversationId: ctx.conversationId ?? null,
      usage: normalizedUsage,
      content: clipLog(raw),
    });
    if (ctx.memoryMode === "read_write") {
      rememberConversationTurn(
        ctx.conversationId,
        options?.memoryUserText ?? user,
        raw,
        options?.memoryTools,
      );
    }
    return raw.trim();
  } catch (error) {
    console.error("[langchain:llm:error]", {
      tag: ctx.logTag,
      durationMs: Date.now() - ctx.start,
      conversationId: ctx.conversationId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * 以流式方式调用模型并实时返回增量文本。
 */
export const invokeTextStream = async (
  system: string,
  user: string,
  options?: InvokeStreamOptions,
) => {
  const ctx = buildLlmInvokeContext(system, user, options, "default-stream");
  console.log("[langchain:llm:stream:request]", ctx.requestLog);
  const model = getChatModel(ctx.modelName);
  let fullText = "";
  try {
    const stream = await model.stream([
      new SystemMessage(system),
      ...ctx.historyMessages,
      new HumanMessage(user),
    ]);
    for await (const chunk of stream) {
      const delta = extractTextFromContent((chunk as any).content);
      if (!delta) continue;
      fullText += delta;
      options?.onDelta?.(delta);
    }
    console.log("[langchain:llm:stream:response]", {
      tag: ctx.logTag,
      durationMs: Date.now() - ctx.start,
      conversationId: ctx.conversationId ?? null,
      content: clipLog(fullText),
    });
    if (ctx.memoryMode === "read_write") {
      rememberConversationTurn(
        ctx.conversationId,
        options?.memoryUserText ?? user,
        fullText,
        options?.memoryTools,
      );
    }
    return fullText.trim();
  } catch (error) {
    console.error("[langchain:llm:stream:error]", {
      tag: ctx.logTag,
      durationMs: Date.now() - ctx.start,
      conversationId: ctx.conversationId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * 从模型文本中提取第一个 JSON 对象。
 */
export const extractFirstJson = <T>(text: string): T | null => {
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
