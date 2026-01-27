/*
 * VoltAgent Engine 总览：
 * - 负责初始化模型 Provider、工具、Memory、以及路由/业务 Workflow；
 * - 通过一层 fetch 包装实现日志与脱敏，统一采集 LLM 请求/响应；
 * - 通过 hooks 与 guardrail 处理 reasoning 注入/清洗与输出；
 * - 最终导出 agent 与 workflows 供服务注册与调用。
 */
// 这是新的 Agent Engine 入口：集中管理模型、工具、workflow 与钩子。
import {
  Agent,
  Memory,
  createOutputGuardrail,
} from "@voltagent/core";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { countTokens } from "gpt-tokenizer";
import "dotenv/config";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
// 引入本地 RAG 工具与执行函数：用于工具调用与 workflow 步骤。
import { createRoutingAgent } from "@/agent/routing/routing-agent";
import {
  createFlightBookingWorkflow,
  createDirectChatWorkflow,
  createLocalRagWorkflow,
  createReturnWorkflow,
  createRoutingWorkflow,
} from "@/agent/engine";
import type {
  TextUIPart,
  UIDataTypes,
  UIMessage,
  UIMessagePart,
  UITools,
} from "ai";

// 对话记忆持久化地址，默认写入本地 sqlite。
const memoryUrl = process.env.VOLTAGENT_MEMORY_URL ?? "file:./agent-memory.db";
const memory = new Memory({
  storage: new LibSQLMemoryAdapter({ url: memoryUrl }),
});
console.log(`[memory] persisting conversations at ${memoryUrl}`);

// 适配 Memory 的动态方法访问，便于包裹日志。
const memoryAny = memory as Memory & Record<string, any>;
// 清理 /no_think 标记，避免污染持久化内容。
const stripNoThinkFromText = (text: string) =>
  text.replace(/\s*\/no_think\b/g, "").trim();

/*
 * 深度遍历参数，剥离 /no_think：
 * - 适配复杂对象/数组结构；
 * - 避免循环引用导致崩溃；
 * - 递归深度限制，防止异常结构。
 */
const stripNoThinkFromValue = (value: unknown): unknown => {
  const seen = new WeakSet<object>();
  const maxDepth = 50;
  // 递归遍历节点，按类型处理字符串/数组/对象。
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === "string") {
      return stripNoThinkFromText(node);
    }
    if (!node || typeof node !== "object") {
      return node;
    }
    if (seen.has(node)) {
      return node;
    }
    if (depth > maxDepth) {
      return node;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      return node.map((item) => walk(item, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, val]) => [
        key,
        walk(val, depth + 1),
      ]),
    );
  };
  return walk(value, 0);
};

/*
 * 给 Memory 方法加一层日志与清洗：
 * - 记录调用参数，便于排查；
 * - 清理 no_think 内容，避免污染记忆；
 * - 保持原有返回值与异常。
 */
const wrapMemoryMethod = (name: string) => {
  const original = memoryAny[name]?.bind(memory);
  if (typeof original !== "function") {
    return;
  }
  memoryAny[name] = async (...args: unknown[]) => {
    const sanitizedArgs = args.map((arg) => stripNoThinkFromValue(arg));
    console.log(`[memory:${name}]`, sanitizedArgs);
    try {
      const result = await original(...sanitizedArgs);
      console.log(`[memory:${name}] success`);
      return result;
    } catch (error) {
      console.error(`[memory:${name}] failed`, error);
      throw error;
    }
  };
};
wrapMemoryMethod("addMessage");
wrapMemoryMethod("saveMessage");

// 将敏感字符串转为短掩码，避免日志泄露完整密钥。
const maskSecret = (value: unknown) => {
  if (typeof value === "string" && value.length > 6) {
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
  }
  return "***";
};

// 递归脱敏 payload 中疑似敏感字段（key/token/authorization 等）。
const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, val]) => {
        if (/key|token|authorization/i.test(key)) {
          return [key, maskSecret(val)];
        }
        return [key, redactSensitive(val)];
      },
    );
    return Object.fromEntries(entries);
  }
  return value;
};

// 脱敏 URL query 参数中的敏感字段。
const redactUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.forEach((val, key) => {
      if (/key|token|authorization/i.test(key)) {
        parsed.searchParams.set(key, maskSecret(val));
      }
    });
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

/*
 * 组装可安全记录的 LLM 请求日志：
 * - 统一脱敏 key/token/authorization 等字段；
 * - 支持 body 为字符串或对象；
 * - 避免直接打印敏感请求体。
 */
const buildLogEntry = (input: RequestInfo | URL, init?: RequestInit) => {
  if (!init?.body) {
    return null;
  }
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const safeUrl = redactUrl(url);
  if (typeof init.body === "string") {
    try {
      const payload = JSON.parse(init.body);
      return { url: safeUrl, payload: redactSensitive(payload) };
    } catch {
      // Fall back to raw body logging below.
    }
  }
  return { url: safeUrl, body: redactSensitive(init.body) };
};

const extractTextParts = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextParts(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return [record.text];
    }
  }
  return [];
};

const estimateInputTokens = (rawBody: string) => {
  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    if (Array.isArray(payload.messages)) {
      let tokens = 0;
      for (const message of payload.messages as Array<Record<string, unknown>>) {
        const parts = extractTextParts(message.content);
        for (const part of parts) {
          tokens += countTokens(part);
        }
      }
      return tokens;
    }
    if (typeof payload.input === "string") {
      return countTokens(payload.input);
    }
    if (typeof payload.prompt === "string") {
      return countTokens(payload.prompt);
    }
  } catch {
    // ignore
  }
  return null;
};

/*
 * 从不同 SDK/Provider 响应中提取 reasoning：
 * - 支持顶层 reasoningText；
 * - 支持 choices/message 中 reasoning_content 字段；
 * - 兼容 OpenAI-compatible 与 provider wrapper 结构。
 */
const extractReasoningText = (output: unknown) => {
  if (!output || typeof output !== "object") {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  if (typeof record.reasoningText === "string") {
    return record.reasoningText.trim();
  }
  if (typeof record.reasoning === "string") {
    return record.reasoning.trim();
  }

  // 统一从 message 上提取 reasoning 字段。
  const normalizeMessage = (
    message: Record<string, unknown> | undefined,
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

  const providerResponse = record.providerResponse as
    | {
        choices?: Array<{ message?: Record<string, unknown> }>;
        body?: {
          choices?: Array<{ message?: Record<string, unknown> }>;
          messages?: Array<Record<string, unknown>>;
        };
        messages?: Array<Record<string, unknown>>;
      }
    | undefined;
  const choices =
    providerResponse?.choices ?? providerResponse?.body?.choices ?? undefined;
  if (choices) {
    for (const choice of choices) {
      const reasoning = normalizeMessage(choice?.message);
      if (reasoning) {
        return reasoning;
      }
    }
  }

  const messages =
    providerResponse?.messages ?? providerResponse?.body?.messages ?? undefined;
  if (messages) {
    for (const message of messages) {
      const reasoning = normalizeMessage(message);
      if (reasoning) {
        return reasoning;
      }
    }
  }

  return undefined;
};

// 缓存 Qwen 最近一次的 reasoning（用于最终输出兜底）。
let lastQwenReasoning: string | undefined;

// 将 reasoning 以 <reason> 包裹并拼接到最终文本。
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

// 从 message 中归一化提取 reasoning 字段。
const normalizeReasonFromMessage = (
  message: Record<string, unknown> | undefined,
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

/*
 * 从 provider response 结构中提取 reasoning：
 * - 覆盖 choices/messages 与 body 内嵌结构；
 * - 一旦命中直接返回，避免重复扫描。
 */
const extractReasoningFromProviderResponse = (response: unknown) => {
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const record = response as {
    choices?: Array<{ message?: Record<string, unknown> }>;
    messages?: Array<Record<string, unknown>>;
    body?: {
      choices?: Array<{ message?: Record<string, unknown> }>;
      messages?: Array<Record<string, unknown>>;
    };
  };
  const choices = record.choices ?? record.body?.choices;
  if (choices) {
    for (const choice of choices) {
      const reasoning = normalizeReasonFromMessage(choice?.message);
      if (reasoning) {
        return reasoning;
      }
    }
  }
  const messages = record.messages ?? record.body?.messages;
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

// 用 Symbol 作为上下文键，避免与业务字段冲突。
const REASONING_CONTEXT_KEY = Symbol("voltagent:reasoning");

// 解析布尔环境变量，允许 0/1/true/false/no/yes。
const parseBooleanEnv = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  return undefined;
};

// 是否将 reasoning 持久化到 Memory（默认 false）。
const shouldStoreReasoningInMemory =
  parseBooleanEnv(process.env.VOLTAGENT_SAVE_REASONING_TO_MEMORY) ?? false;

// 清理 <think>/<reason> 标签，避免泄露推理细节。
const THINK_TAG_REGEX =
  /<\s*(?:think|reason)[^>]*>[\s\S]*?<\/\s*(?:think|reason)\s*>/gi;
// 移除文本中的 think/reason 标签。
const stripThinkTags = (text: string) =>
  text.replace(THINK_TAG_REGEX, "").trim();

/*
 * 记忆落库前的消息清洗：
 * - 移除 <think>/<reason>；
 * - 过滤空文本段，避免保存空壳消息。
 */
const sanitizeMessageForMemory = (message: UIMessage): UIMessage => {
  const sanitizedParts = message.parts
    ?.map((part) => {
      if (isTextPart(part)) {
        const cleaned = stripThinkTags(part.text);
        return { ...part, text: cleaned };
      }
      return { ...part };
    })
    .filter((part) => !(isTextPart(part) && !part.text));
  if (sanitizedParts && sanitizedParts.length > 0) {
    return { ...message, parts: sanitizedParts };
  }
  return message;
};

/*
 * Qwen 发送前清洗：
 * - 删除思维标签，避免模型看到内部推理；
 * - 维持 parts 结构，兼容多模态输入。
 */
const sanitizeMessageForQwen = (message: UIMessage): UIMessage => {
  const sanitizedParts =
    message.parts?.map((part) => {
      if (isTextPart(part)) {
        const cleaned = stripThinkTags(part.text);
        return { ...part, text: cleaned };
      }
      return { ...part };
    }) ?? [];
  const filteredParts = sanitizedParts.filter(
    (part) => !(isTextPart(part) && !part.text),
  );
  return {
    ...message,
    parts: filteredParts,
  };
};

// 类型守卫：判断 UIMessagePart 是否为文本。
const isTextPart = (
  part?: UIMessagePart<UIDataTypes, UITools>,
): part is TextUIPart => Boolean(part && part.type === "text");

// 判断消息 parts 是否已包含 <reason>。
const hasReasonPart = (parts?: UIMessage["parts"]) =>
  Boolean(
    parts?.some((part) => isTextPart(part) && part.text.includes("<reason>")),
  );

// 将 reasoning 作为首段文本插入消息。
const withReasonMessage = (
  message: UIMessage,
  reasoning: string,
): UIMessage => {
  const trimmed = reasoning.trim();
  if (!trimmed) {
    return message;
  }
  const existingParts = message.parts?.map((part) => ({ ...part })) ?? [];
  if (hasReasonPart(existingParts)) {
    return message;
  }
  const reasonPart: TextUIPart = {
    type: "text",
    text: `<reason>${trimmed}</reason>`,
  };
  return {
    ...message,
    parts: [reasonPart, ...existingParts],
  };
};

// saveMessageWithContext 的参数类型别名，便于复用签名。
type SaveMessageWithContextArgs = Parameters<
  typeof memory.saveMessageWithContext
>;

/*
 * 拦截 Memory.saveMessageWithContext：
 * - 可选注入 reasoning；
 * - 统一做 think 标签清洗；
 * - 保持原调用签名不变。
 */
const originalSaveMessageWithContext =
  memory.saveMessageWithContext.bind(memory);
memory.saveMessageWithContext = async function (
  message: SaveMessageWithContextArgs[0],
  userId: SaveMessageWithContextArgs[1],
  conversationId: SaveMessageWithContextArgs[2],
  context: SaveMessageWithContextArgs[3],
  operationContext: SaveMessageWithContextArgs[4],
) {
  const reasoning = operationContext?.context?.get(REASONING_CONTEXT_KEY);
  const shouldInjectReasoning =
    shouldStoreReasoningInMemory &&
    message.role === "assistant" &&
    typeof reasoning === "string" &&
    reasoning.trim();
  const nextMessage = shouldInjectReasoning
    ? withReasonMessage(message, reasoning)
    : message;
  const messageToStore = shouldStoreReasoningInMemory
    ? nextMessage
    : sanitizeMessageForMemory(nextMessage);
  return originalSaveMessageWithContext(
    messageToStore,
    userId,
    conversationId,
    context,
    operationContext,
  );
};

/*
 * 输出守卫：把 reasoning 注入到最终文本中（仅在需要时）：
 * - 输出已包含 <reason> 时跳过；
 * - 注入后清理上下文，避免重复。
 */
const reasoningInjectionGuardrail = createOutputGuardrail({
  id: "reasoning-injector",
  name: "Inject reasoning when available",
  handler: ({ outputText, context: oc }) => {
    if (typeof outputText !== "string") {
      return { pass: true };
    }
    const reasoning = oc.context.get(REASONING_CONTEXT_KEY);
    if (typeof reasoning !== "string" || !reasoning.trim()) {
      return { pass: true };
    }
    if (outputText.includes("<reason>")) {
      oc.context.delete(REASONING_CONTEXT_KEY);
      return { pass: true };
    }
    oc.context.delete(REASONING_CONTEXT_KEY);
    const modifiedOutput = wrapTextWithReason(reasoning, outputText);
    return {
      pass: true,
      action: "modify",
      modifiedOutput,
    };
  },
});

// 收口输出日志，统一记录 reasoning 与最终文本。
const logFinalOutput = (output: unknown) => {
  if (!output || typeof output !== "object") {
    return;
  }
  const reasoning = extractReasoningText(output);
  const resolvedReasoning = reasoning ?? lastQwenReasoning;
  if (resolvedReasoning) {
    console.log("\n[final reasoning]", resolvedReasoning);
    lastQwenReasoning = undefined;
  }
  const text = (output as { text?: unknown }).text;
  if (typeof text === "string") {
    console.log("\n[final]", text);
  }
};

// 输出 LLM 请求日志（含脱敏 payload）。
const logLLMRequest = (
  label: string,
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const entry = buildLogEntry(input, init);
  if (!entry) {
    return;
  }
  if (typeof init?.body === "string") {
    const tokens = estimateInputTokens(init.body);
    if (typeof tokens === "number") {
      const yellow = "\u001b[33m";
      const reset = "\u001b[0m";
      console.log(`${yellow}[llm:input-tokens] ${label}${reset}`, {
        tokens,
      });
    }
  }
  console.log(`\n[llm:request] ${label}`);
  console.dir(entry, { depth: null });
};

// 打印 LLM 响应关键字段（含 usage 与 reasoning）。
const logLLMResponse = async (label: string, response: Response) => {
  try {
    const cloned = response.clone();
    const body = await cloned.json();
    const reasoning =
      body?.choices?.[0]?.message?.reasoning_content ??
      body?.choices?.[0]?.message?.reasoning;
    if (label === "qwen" && typeof reasoning === "string") {
      lastQwenReasoning = reasoning.trim();
    }
    console.log(`\n[llm:response] ${label}`);
    console.dir(
      {
        status: response.status,
        usage: body?.usage,
        reasoning:
          typeof reasoning === "string" && reasoning.trim().length > 0
            ? reasoning
            : undefined,
      },
      { depth: null },
    );
  } catch {
    // Ignore response logging failures.
  }
};

// 兼容 Headers/数组/对象的读取方式，统一拿到 header 值。
const readHeaderValue = (
  headers: HeadersInit | undefined,
  name: string,
): string | undefined => {
  if (!headers) {
    return undefined;
  }
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(name) ?? headers.get(target) ?? undefined;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === target) {
        return value;
      }
    }
    return undefined;
  }
  const record = headers as Record<string, string | string[]>;
  const direct = record[name] ?? record[target];
  if (Array.isArray(direct)) {
    return direct[0];
  }
  return direct;
};

// 解析自定义 Header，允许前端控制 Qwen thinking 开关。
const parseEnableThinkingHeader = (
  headers: HeadersInit | undefined,
): boolean | undefined => {
  const raw = readHeaderValue(headers, "x-qwen-enable-thinking");
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
};

/*
 * 创建带日志的 fetch 包装器：
 * - 请求前做脱敏日志；
 * - 可选重写 body（改 role / 插入指令等）；
 * - 可选记录响应摘要。
 */
const createLoggedFetch = (
  label: string,
  transformBody?: (body: string, init?: RequestInit) => string,
  options?: { logResponse?: boolean },
): typeof fetch => {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string" && transformBody) {
      try {
        const nextBody = transformBody(init.body, init);
        const nextInit = { ...init, body: nextBody };
        logLLMRequest(label, input, nextInit);
        const response = await fetch(input, nextInit);
        if (options?.logResponse) {
          await logLLMResponse(label, response);
        }
        return response;
      } catch {
        // Fall back to default logging below.
      }
    }
    logLLMRequest(label, input, init);
    const response = await fetch(input, init);
    if (options?.logResponse) {
      await logLLMResponse(label, response);
    }
    return response;
  };
};

// 将 OpenAI “developer” 角色改写为 “system”（兼容部分 provider）。
const rewriteDeveloperRole = (body: string) => {
  const payload = JSON.parse(body);
  if (!Array.isArray(payload?.messages)) {
    return body;
  }
  payload.messages = payload.messages.map((message: { role?: string }) => {
    if (message?.role === "developer") {
      return { ...message, role: "system" };
    }
    return message;
  });
  return JSON.stringify(payload);
};

// 将 Qwen reasoning 指令写入 system prompt（如未包含）。
const injectQwenReasoningLanguage = (body: string) => {
  try {
    const payload = JSON.parse(body);
    if (!Array.isArray(payload?.messages)) {
      return body;
    }
    const instruction = process.env.QWEN_REASONING_INSTRUCTION?.trim();
    if (!instruction) {
      return body;
    }
    const firstMessage = payload.messages[0];
    if (
      firstMessage?.role === "system" &&
      typeof firstMessage.content === "string"
    ) {
      if (!firstMessage.content.includes(instruction)) {
        firstMessage.content = `${firstMessage.content}\n${instruction}`.trim();
      }
      return JSON.stringify(payload);
    }
    payload.messages.unshift({ role: "system", content: instruction });
    return JSON.stringify(payload);
  } catch {
    return body;
  }
};

/*
 * 对最后一条用户消息追加 /no_think：
 * - 适配字符串与多段 content；
 * - 避免重复追加；
 * - 仅用于兼容本地模型的禁思考开关。
 */
const appendNoThinkToBody = (body: string) => {
  try {
    const payload = JSON.parse(body);
    if (!Array.isArray(payload?.messages)) {
      return body;
    }
    for (let i = payload.messages.length - 1; i >= 0; i -= 1) {
      const message = payload.messages[i];
      if (message?.role !== "user") {
        continue;
      }
      if (typeof message.content === "string") {
        if (!message.content.includes("/no_think")) {
          message.content = `${message.content} /no_think`;
        }
        break;
      }
      if (Array.isArray(message.content)) {
        const hasNoThink = message.content.some(
          (part: { text?: unknown }) =>
            typeof part?.text === "string" && part.text.includes("/no_think"),
        );
        if (!hasNoThink) {
          message.content = [
            ...message.content,
            { type: "text", text: " /no_think" },
          ];
        }
        break;
      }
      break;
    }
    return JSON.stringify(payload);
  } catch {
    return body;
  }
};

/*
 * 启用 Qwen thinking：
 * - 读取 header 覆盖 enable_thinking；
 * - 对流式输出补充 usage；
 * - 可选设置 thinking_budget。
 */
const enableQwenThinking = (body: string, enableThinking?: boolean) => {
  try {
    const payload = JSON.parse(body);
    if (!payload || typeof payload !== "object") {
      return body;
    }
    if (typeof payload.enable_thinking !== "boolean") {
      if (typeof enableThinking !== "boolean") {
        return body;
      }
      payload.enable_thinking = enableThinking;
    }
    if (payload.stream === true) {
      if (
        !payload.stream_options ||
        typeof payload.stream_options !== "object"
      ) {
        payload.stream_options = {};
      }
      payload.stream_options.include_usage = true;
    }
    const budget = parseOptionalNumber(process.env.QWEN_THINKING_BUDGET);
    if (budget !== undefined) {
      payload.thinking_budget = budget;
    }
    return JSON.stringify(payload);
  } catch {
    return body;
  }
};

// 解析可选数字环境变量，非法时返回 undefined。
const parseOptionalNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// 是否在 LM Studio 下强制追加 /no_think。
const lmStudioNoThink =
  (process.env.LM_STUDIO_NO_THINK ?? "").toLowerCase() === "true";

// Ollama（本地）OpenAI 兼容 Provider。
const ollamaProvider = createOpenAI({
  // Ollama's OpenAI-compatible endpoint.
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
  fetch: createLoggedFetch("openai"),
});

// LM Studio（本地）OpenAI 兼容 Provider。
const lmStudioProvider = createOpenAI({
  baseURL: "http://127.0.0.1:1234/v1",
  apiKey: "lmstudio",
  fetch: createLoggedFetch("lmstudio", (body) => {
    const next = rewriteDeveloperRole(body);
    return lmStudioNoThink ? appendNoThinkToBody(next) : next;
  }),
});

// Qwen（通义）OpenAI 兼容 Provider。
const qwenProvider = createOpenAI({
  baseURL:
    process.env.QWEN_BASE_URL ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? "",
  fetch: createLoggedFetch(
    "qwen",
    (body, init) => {
      const enableThinking = parseEnableThinkingHeader(init?.headers);
      return enableQwenThinking(
        injectQwenReasoningLanguage(rewriteDeveloperRole(body)),
        enableThinking,
      );
    },
    { logResponse: true },
  ),
});

// Google Generative AI Provider。
const googleProvider = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  fetch: createLoggedFetch("google"),
});

// 从环境变量读取 Agent 的系统指令。
const instructions = process.env.VOLTAGENT_INSTRUCTIONS?.trim();

if (!instructions) {
  throw new Error("Missing VOLTAGENT_INSTRUCTIONS in .env");
} else {
  console.log("Loaded VOLTAGENT_INSTRUCTIONS:");
  console.log(instructions);
}

// 从环境变量读取模型 Provider 与相关参数。
const provider = (process.env.MODEL_PROVIDER ?? "ollama").toLowerCase();
// LM Studio 温度与最大输出 token 参数。
const lmStudioTemperature = parseOptionalNumber(
  process.env.LM_STUDIO_TEMPERATURE,
);
const lmStudioMaxTokens = parseOptionalNumber(process.env.LM_STUDIO_MAX_TOKENS);
// 将最大 token 过滤为合法值（>=1）。
const lmStudioMaxOutputTokens =
  lmStudioMaxTokens !== undefined && lmStudioMaxTokens >= 1
    ? lmStudioMaxTokens
    : undefined;

if (provider === "google" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY in .env");
}
if (
  provider === "qwen" &&
  !process.env.QWEN_API_KEY &&
  !process.env.DASHSCOPE_API_KEY
) {
  throw new Error("Missing QWEN_API_KEY or DASHSCOPE_API_KEY in .env");
}

// 根据 provider 选择模型实例。
const model =
  provider === "google"
    ? googleProvider(process.env.GOOGLE_MODEL ?? "gemini-1.5-flash")
    : provider === "lmstudio"
      ? lmStudioProvider.chat(process.env.LM_STUDIO_MODEL ?? "local-model")
      : provider === "qwen"
        ? qwenProvider.chat(process.env.QWEN_MODEL ?? "qwen-plus")
        : ollamaProvider.chat(process.env.OLLAMA_MODEL ?? "llama3.2:1b");

// 主 Agent 实例：挂载工具、Memory、Guardrails 与 hooks。
const agent = new Agent({
  name: "FinyxWaaSAgent",
  instructions,
  model,
  temperature:
    provider === "lmstudio" ? (lmStudioTemperature ?? 0.7) : undefined,
  maxOutputTokens:
    provider === "lmstudio" ? lmStudioMaxOutputTokens : undefined,
  /*
   * 主 Agent 不挂载任何工具，避免额外 token 与误触发。
   * 工具仅在各业务 workflow 内部使用。
   */
  tools: [],
  memory,
  outputGuardrails: [reasoningInjectionGuardrail],
  hooks: {
    onPrepareMessages: (args) => {
      if (provider !== "qwen") {
        return { messages: args.messages };
      }
      // Qwen 发送前去除 think 标签，避免泄露推理。
      const sanitizedMessages = args.messages.map((message) =>
        sanitizeMessageForQwen(message),
      );
      return { messages: sanitizedMessages };
    },
    // onToolStart: ({ tool, args }) => {
    //   console.log("\n[tool:start]", tool.name, args);
    // },
    // onToolEnd: ({ tool, output, error }) => {
    //   if (error) {
    //     console.log("\n[tool:error]", tool.name, error);
    //     return;
    //   }
    //   console.log("\n[tool:end]", tool.name, output);
    // },
    onStepFinish: ({ step, context: oc }) => {
      try {
        const reasoning =
          extractReasoningFromProviderResponse(step?.response) ??
          extractReasoningFromProviderResponse(step?.result?.response);
        if (reasoning) {
          oc.context.set(REASONING_CONTEXT_KEY, reasoning);
        }
      } catch (error) {
        console.error("[hook:onStepFinish] failed to capture reasoning", error);
      }
    },
    onEnd: ({ output }) => {
      console.log("\n[agent:hook-output]", output);
      logFinalOutput(output);
    },
  },
});

// 路由专用 Agent：仅用于 workflow 选择，输出尽量确定。
const routingAgent = createRoutingAgent(model);

const localRagWorkflow = createLocalRagWorkflow({ agent, provider });

const returnWorkflow = createReturnWorkflow({ agent, provider });

const flightBookingWorkflow = createFlightBookingWorkflow({ agent, provider });

const directChatWorkflow = createDirectChatWorkflow({ agent, provider });

const routingWorkflow = createRoutingWorkflow({ routingAgent, provider });

/*
 * 对外导出的 Engine 组件：
 * - agent: 核心对话 Agent（含工具与 Guardrails）
 * - workflows: 可被 VoltAgent 服务注册的 workflow 集合
 * - localRagWorkflow: 直接暴露单个本地 RAG workflow，便于定向调用
 */
export {
  agent,
  localRagWorkflow,
  returnWorkflow,
  flightBookingWorkflow,
  directChatWorkflow,
  routingWorkflow,
};

export const workflows = {
  localRagWorkflow,
  returnWorkflow,
  flightBookingWorkflow,
  directChatWorkflow,
  routingWorkflow,
};
