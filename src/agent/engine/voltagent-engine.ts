// 这是新的 Agent Engine 入口：集中管理模型、工具、workflow 与钩子。
import {
  Agent,
  Memory,
  tool,
  createWorkflow,
  andThen,
  createOutputGuardrail,
} from "@voltagent/core";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import "dotenv/config";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
// 引入本地 RAG 工具与执行函数：用于工具调用与 workflow 步骤。
import { localRagTool, runLocalRag } from "@/agent/tools/local-rag-tool";
import { buildSkillContextPrefix } from "@/agent/skills/skill-loader";
import {
  buildToolCallContext,
  resolveToolCallTools,
} from "@/agent/config/tool-call-policy";
import { createRoutingAgent } from "@/agent/routing/routing-agent";
import { ROUTING_WORKFLOWS } from "@/agent/routing/routing-config";
import type {
  TextUIPart,
  UIDataTypes,
  UIMessage,
  UIMessagePart,
  UITools,
} from "ai";

/*
 * 网站内容抓取工具：
 * - 用于将网页原文提取为纯文本，便于后续摘要/分析；
 * - 内建超时与重试，避免请求挂死；
 * - 对 HTML 做基础清洗，减少脚本/样式噪声。
 */
const fetchWebsiteTool = tool({
  name: "fetch_website_content",
  description:
    "Fetch raw text content from a URL for summarization or analysis.",
  parameters: z.object({
    url: z.string().url(),
    maxChars: z.number().int().positive().max(20000).optional(),
  }),
  outputSchema: z.object({
    url: z.string().url(),
    content: z.string(),
  }),
  execute: async ({ url, maxChars = 10000 }) => {
    console.log("\n[tool:exec] fetch_website_content", { url, maxChars });
    // Retry limit for network fetches.
    const maxRetries = 2;
    // Per-request timeout to avoid hanging.
    const timeoutMs = 15000;
    // Capture last error for reporting.
    let lastError: unknown;
    // Track the successful response (if any).
    let response: Response | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      // Abort controller for per-attempt timeout.
      const controller = new AbortController();
      // Timer to cancel the request after timeout.
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": "VoltAgent/1.0",
          },
          signal: controller.signal,
        });
        break;
      } catch (error) {
        lastError = error;
        console.log("\n[tool:exec] fetch_website_content retry", {
          attempt,
          error: String(error),
        });
        if (attempt === maxRetries) {
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!response) {
      throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      );
    }

    // Content type for basic HTML stripping.
    const contentType = response.headers.get("content-type") ?? "";
    // Raw response text before normalization.
    const rawText = await response.text();
    console.log("\n[tool:exec] fetch_website_content response", {
      contentType,
      status: response.status,
    });
    // Normalized text for the tool output.
    const content = contentType.includes("text/html")
      ? rawText
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : rawText.trim();

    return {
      url,
      content: content.slice(0, maxChars),
    };
  },
});

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

// Convert a secret into a short masked string.
const maskSecret = (value: unknown) => {
  if (typeof value === "string" && value.length > 6) {
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
  }
  return "***";
};

// Recursively redact secret-like fields in payloads.
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

// Redact secrets in URL query params.
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

const shouldStoreReasoningInMemory =
  parseBooleanEnv(process.env.VOLTAGENT_SAVE_REASONING_TO_MEMORY) ?? false;

// 清理 <think>/<reason> 标签，避免泄露推理细节。
const THINK_TAG_REGEX =
  /<\s*(?:think|reason)[^>]*>[\s\S]*?<\/\s*(?:think|reason)\s*>/gi;
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

// Print a redacted LLM request payload to logs.
const logLLMRequest = (
  label: string,
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const entry = buildLogEntry(input, init);
  if (!entry) {
    return;
  }
  console.log(`\n[llm:request] ${label}`);
  console.dir(entry, { depth: null });
};

// 打印 LLM 响应的关键字段（含 usage 与 reasoning）。
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

// Rewrite "developer" role to "system" for providers that expect it.
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

// LM Studio 是否强制追加 /no_think。
const lmStudioNoThink =
  (process.env.LM_STUDIO_NO_THINK ?? "").toLowerCase() === "true";

// OpenAI-compatible provider for local Ollama.
const ollamaProvider = createOpenAI({
  // Ollama's OpenAI-compatible endpoint.
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
  fetch: createLoggedFetch("openai"),
});

// OpenAI-compatible provider for local LM Studio.
const lmStudioProvider = createOpenAI({
  baseURL: "http://127.0.0.1:1234/v1",
  apiKey: "lmstudio",
  fetch: createLoggedFetch("lmstudio", (body) => {
    const next = rewriteDeveloperRole(body);
    return lmStudioNoThink ? appendNoThinkToBody(next) : next;
  }),
});

// Qwen provider using OpenAI-compatible API.
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

// Google provider using the AI SDK wrapper.
const googleProvider = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  fetch: createLoggedFetch("google"),
});

// Agent instructions pulled from environment.
const instructions = process.env.VOLTAGENT_INSTRUCTIONS?.trim();

if (!instructions) {
  throw new Error("Missing VOLTAGENT_INSTRUCTIONS in .env");
} else {
  console.log("Loaded VOLTAGENT_INSTRUCTIONS:");
  console.log(instructions);
}

// Selected model provider from environment.
const provider = (process.env.MODEL_PROVIDER ?? "ollama").toLowerCase();
const lmStudioTemperature = parseOptionalNumber(
  process.env.LM_STUDIO_TEMPERATURE,
);
const lmStudioMaxTokens = parseOptionalNumber(process.env.LM_STUDIO_MAX_TOKENS);
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

// Model selection based on provider.
const model =
  provider === "google"
    ? googleProvider(process.env.GOOGLE_MODEL ?? "gemini-1.5-flash")
    : provider === "lmstudio"
      ? lmStudioProvider.chat(process.env.LM_STUDIO_MODEL ?? "local-model")
      : provider === "qwen"
        ? qwenProvider.chat(process.env.QWEN_MODEL ?? "qwen-plus")
        : ollamaProvider.chat(process.env.OLLAMA_MODEL ?? "llama3.2:1b");

// Main agent instance with tools and hooks.
const agentTools = [fetchWebsiteTool, localRagTool];
const agent = new Agent({
  name: "FinyxWaaSAgent",
  instructions,
  model,
  temperature:
    provider === "lmstudio" ? (lmStudioTemperature ?? 0.7) : undefined,
  maxOutputTokens:
    provider === "lmstudio" ? lmStudioMaxOutputTokens : undefined,
  /*
   * 工具列表改为动态解析：
   * - 通过上下文 ragMode + 策略控制是否允许工具调用；
   * - 解决“静态工具列表无法被调用时禁用”的问题。
   */
  tools: ({ context }) => resolveToolCallTools(context, agentTools),
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
    onToolStart: ({ tool, args }) => {
      console.log("\n[tool:start]", tool.name, args);
    },
    onToolEnd: ({ tool, output, error }) => {
      if (error) {
        console.log("\n[tool:error]", tool.name, error);
        return;
      }
      console.log("\n[tool:end]", tool.name, output);
    },
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

// Routing-only agent: minimal prompt and deterministic output.
const routingAgent = createRoutingAgent(model);

/*
 * 本地 RAG Workflow（带可选 LLM 回退）：
 * - 输入包含 query 与前端传来的 ragMode；
 * - ragMode=rag 时优先走本地 RAG；
 * - hybrid 模式下根据 distance 阈值决定是否回退到 LLM；
 * - ragMode=llm 时直接调用 agent 生成答案；
 * - 输出统一为 { text, sources, score, distance }，便于前端消费。
 */
const localRagWorkflow = createWorkflow(
  {
    id: "local-rag-workflow",
    name: "Local RAG Workflow",
    purpose: "Run local RAG retrieval and optionally fall back to LLM.",
    input: z.object({
      query: z.string().min(1),
      options: z
        .object({
          ragMode: z.enum(["rag", "llm"]).optional(),
          userId: z.string().optional(),
          conversationId: z.string().optional(),
          enableThinking: z.boolean().optional(),
        })
        .optional(),
    }),
    result: z.object({
      text: z.string(),
      sources: z.array(
        z.object({
          title: z.string(),
          url: z.string().optional(),
        }),
      ),
      score: z.number().nullable(),
      distance: z.number().nullable(),
    }),
  },
  andThen({
    id: "local-rag-retrieve",
    name: "本地RAG检索与回退",
    purpose: "优先本地RAG，必要时回退到Agent生成。",
    inputSchema: z.object({
      query: z.string().min(1),
      options: z
        .object({
          ragMode: z.enum(["rag", "llm"]).optional(),
          userId: z.string().optional(),
          conversationId: z.string().optional(),
          enableThinking: z.boolean().optional(),
        })
        .optional(),
    }),
    outputSchema: z.object({
      text: z.string(),
      sources: z.array(
        z.object({
          title: z.string(),
          url: z.string().optional(),
        }),
      ),
      score: z.number().nullable(),
      distance: z.number().nullable(),
    }),
    execute: async ({ data }) => {
      const skillContextPrefix = await buildSkillContextPrefix(data.query);
      const buildUserPrompt = (query: string) =>
        skillContextPrefix
          ? `${skillContextPrefix}\n\nUser Question:\n${query}`
          : query;
      const mode = process.env.AGENT_PROXY_MODE ?? "local-rag";
      const ragMode = data.options?.ragMode === "llm" ? "llm" : "rag";
      const yellow = "\u001b[33m";
      const reset = "\u001b[0m";
      console.log(
        `${yellow}[rag-flow] 当前分支判断${reset}`,
        JSON.stringify({ ragMode, proxyMode: mode }),
      );
      /*
       * 本地 RAG + LLM 拼接开关：
       * - LOCAL_RAG_USE_LLM_SUMMARY 默认开启（除非显式设为 false）；
       * - 开启时：RAG 命中则作为上下文提示词给 LLM，总结/润色；
       * - 关闭时：命中就直接返回 RAG 结果，不再走 LLM。
       */
      const enableSummary =
        (process.env.LOCAL_RAG_USE_LLM_SUMMARY ?? "").toLowerCase() !== "false";
      if (!enableSummary) {
        console.log(
          `${yellow}[rag-flow] LLM summary 禁用${reset}`,
          JSON.stringify({ reason: "LOCAL_RAG_USE_LLM_SUMMARY=false" }),
        );
      }
      /*
       * 检索阈值：
       * - 优先使用 RAG_SCORE_THRESHOLD（越大越严格）；
       * - 若未提供 score 阈值，则回退到 RAG_DISTANCE_THRESHOLD（越小越严格）；
       * - 兼容旧配置，同时为“统一 score 语义”预留升级路径。
       */
      const scoreThresholdRaw = process.env.RAG_SCORE_THRESHOLD;
      const scoreThreshold = scoreThresholdRaw
        ? Number(scoreThresholdRaw)
        : undefined;
      const distanceThreshold = Number(
        process.env.RAG_DISTANCE_THRESHOLD ?? 0.35,
      );
      const hasScoreThreshold = Number.isFinite(scoreThreshold);
      /*
       * enableThinking 处理：
       * - 与旧流程一致，仅对 Qwen 开关推理能力；
       * - 通过 providerOptions.headers 传入到请求头中。
       */
      const enableThinking =
        typeof data.options?.enableThinking === "boolean"
          ? data.options.enableThinking
          : undefined;
      const requestHeaders =
        provider === "qwen" && enableThinking !== undefined
          ? { "x-qwen-enable-thinking": String(enableThinking) }
          : undefined;
      if (ragMode === "rag" && (mode === "local-rag" || mode === "hybrid")) {
        // 先走本地 RAG，判断是否“找到答案”。
        const ragResult = await runLocalRag(data.query);
        const isAnswer =
          ragResult.text.trim() !== "不知道。" &&
          (hasScoreThreshold
            ? ragResult.score !== null &&
              ragResult.score >= (scoreThreshold as number)
            : ragResult.distance !== null &&
              ragResult.distance <= distanceThreshold);
        console.log(
          `${yellow}[rag-flow] 本地RAG命中结果${reset}`,
          JSON.stringify(
            {
              hit: isAnswer,
              score: ragResult.score,
              distance: ragResult.distance,
              threshold: hasScoreThreshold
                ? { score: scoreThreshold }
                : { distance: distanceThreshold },
              content: isAnswer ? ragResult.text : undefined,
              sources: isAnswer ? ragResult.sources : undefined,
              snippets: isAnswer ? ragResult.snippets : undefined,
            },
            null,
            2,
          ),
        );
        if (!enableSummary && isAnswer) {
          // 关闭 LLM 拼接时，直接返回本地 RAG 结果。
          return ragResult;
        }
        if (enableSummary) {
          // 开启 LLM 拼接：有命中就用 RAG 作为上下文提示词。
          if (isAnswer) {
            console.log(
              `${yellow}[rag-flow] 本地RAG召回内容${reset}`,
              JSON.stringify(
                {
                  text: ragResult.text,
                  snippets: ragResult.snippets,
                  sources: ragResult.sources,
                  score: ragResult.score,
                  distance: ragResult.distance,
                },
                null,
                2,
              ),
            );
            /*
             * RAG 提示词组装（强化版）：
             * - 严格约束：只能使用 Context，禁止编造；
             * - 结构化 Context：来源列表 + 片段正文；
             * - 输出要求：简洁、有引用编号；
             * - 若证据不足，直接回答“不知道”。
             */
            const sourcesBlock =
              ragResult.snippets && ragResult.snippets.length > 0
                ? ragResult.snippets
                    .map((snippet, index) => {
                      const label = `[${index + 1}] ${snippet.title}`;
                      const url = snippet.url ? ` (${snippet.url})` : "";
                      return `${label}${url}`;
                    })
                    .join("\n")
                : ragResult.sources.length > 0
                  ? ragResult.sources
                      .map((source, index) => {
                        const label = `[${index + 1}] ${source.title}`;
                        const url = source.url ? ` (${source.url})` : "";
                        return `${label}${url}`;
                      })
                      .join("\n")
                  : "无可用来源";
            const contextSnippet =
              ragResult.text.length > 800
                ? `${ragResult.text.slice(0, 800).trimEnd()}…`
                : ragResult.text;
            /*
             * 片段按来源编号拼装：
             * - 优先使用 ragResult.snippets 的逐条内容；
             * - 若缺失则退回单段 contextSnippet。
             */
            const snippetItems =
              ragResult.snippets && ragResult.snippets.length > 0
                ? ragResult.snippets
                : null;
            const contextBlocks = snippetItems
              ? snippetItems
                  .map((snippet, index) => {
                    const label = `[${index + 1}] ${snippet.title}`;
                    const url = snippet.url ? ` (${snippet.url})` : "";
                    return `${label}${url}\n${snippet.content}`;
                  })
                  .join("\n\n")
              : contextSnippet;
            const contextLines = [
              "你是一个基于检索内容回答问题的助手。",
              "规则：只使用 Context 中的信息作答；禁止编造或补充未出现的事实。",
              "若 Context 不能回答问题，请直接回答“不知道”。",
              "回答要求：简洁明了，必要时做总结/润色；答案末尾用 [1][2] 标注引用来源。",
              "",
              "Context Sources:",
              sourcesBlock,
              "",
              "Context Snippets:",
              contextBlocks,
              "",
              `Question: ${data.query}`,
              "Answer:",
            ];
            const basePrompt = contextLines.join("\n");
            const prompt = skillContextPrefix
              ? `${skillContextPrefix}\n\n${basePrompt}`
              : basePrompt;
            console.log(`${yellow}[rag-flow] 组装Prompt${reset}\n${prompt}`);
            const llmResult = await agent.generateText(prompt, {
              userId: data.options?.userId,
              conversationId: data.options?.conversationId,
              headers: requestHeaders,
              // 注入 ragMode 到上下文，用于动态工具策略判断。
              context: buildToolCallContext(ragMode),
            });
            const text =
              typeof llmResult.text === "string" && llmResult.text.trim()
                ? llmResult.text
                : "I did not get a response. Please try again.";
            return {
              text,
              sources: ragResult.sources,
              score: ragResult.score,
              distance: ragResult.distance,
            };
          }
          // 未命中就让 LLM 直接思考回答。
          const llmResult = await agent.generateText(buildUserPrompt(data.query), {
            userId: data.options?.userId,
            conversationId: data.options?.conversationId,
            headers: requestHeaders,
            // 注入 ragMode 到上下文，用于动态工具策略判断。
            context: buildToolCallContext(ragMode),
          });
          const text =
            typeof llmResult.text === "string" && llmResult.text.trim()
              ? llmResult.text
              : "I did not get a response. Please try again.";
          return {
            text,
            sources: [],
            score: null,
            distance: null,
          };
        }
        // 关闭 LLM 拼接时，如果未命中且处于 hybrid，则回退到 LLM。
        const shouldFallback = mode === "hybrid" && !isAnswer;
        if (!shouldFallback) {
          return ragResult;
        }
      }
      // ragMode=llm 或非 RAG 模式时，直接走 LLM。
      const llmResult = await agent.generateText(buildUserPrompt(data.query), {
        userId: data.options?.userId,
        conversationId: data.options?.conversationId,
        headers: requestHeaders,
        // 注入 ragMode 到上下文，用于动态工具策略判断。
        context: buildToolCallContext(ragMode),
      });
      const text =
        typeof llmResult.text === "string" && llmResult.text.trim()
          ? llmResult.text
          : "I did not get a response. Please try again.";
      return {
        text,
        sources: [],
        score: null,
        distance: null,
      };
    },
  }),
);


const returnCaseSchema = z.object({
  decision: z.enum(["eligible", "ineligible", "needs_info"]),
  missingFields: z.array(z.string()),
  nextSteps: z.array(z.string()),
  summary: z.string(),
  request: z.object({
    orderId: z.string().optional(),
    contact: z.string().optional(),
    items: z.string().optional(),
    purchaseDate: z.string().optional(),
    reason: z.string().optional(),
    condition: z.string().optional(),
    preferredResolution: z.string().optional(),
  }),
});

type ReturnCase = z.infer<typeof returnCaseSchema>;

const coerceStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : String(item)))
        .filter(Boolean)
    : [];

const normalizeReturnCase = (payload: any): ReturnCase => {
  const decision =
    payload?.decision === "eligible" ||
    payload?.decision === "ineligible" ||
    payload?.decision === "needs_info"
      ? payload.decision
      : "needs_info";
  return {
    decision,
    missingFields: coerceStringArray(payload?.missingFields),
    nextSteps: coerceStringArray(payload?.nextSteps),
    summary: typeof payload?.summary === "string" ? payload.summary.trim() : "",
    request: {
      orderId:
        typeof payload?.request?.orderId === "string"
          ? payload.request.orderId.trim()
          : undefined,
      contact:
        typeof payload?.request?.contact === "string"
          ? payload.request.contact.trim()
          : undefined,
      items:
        typeof payload?.request?.items === "string"
          ? payload.request.items.trim()
          : undefined,
      purchaseDate:
        typeof payload?.request?.purchaseDate === "string"
          ? payload.request.purchaseDate.trim()
          : undefined,
      reason:
        typeof payload?.request?.reason === "string"
          ? payload.request.reason.trim()
          : undefined,
      condition:
        typeof payload?.request?.condition === "string"
          ? payload.request.condition.trim()
          : undefined,
      preferredResolution:
        typeof payload?.request?.preferredResolution === "string"
          ? payload.request.preferredResolution.trim()
          : undefined,
    },
  };
};

const extractJsonPayload = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return null;
};

const parseReturnCase = (text: string): ReturnCase => {
  const payload = extractJsonPayload(text);
  if (payload) {
    try {
      const parsed = JSON.parse(payload);
      const normalized = normalizeReturnCase(parsed);
      const result = returnCaseSchema.safeParse(normalized);
      if (result.success) {
        return result.data;
      }
    } catch (error) {
      console.warn("[return-workflow] failed to parse JSON", error);
    }
  }
  return {
    decision: "needs_info",
    missingFields: [
      "orderId",
      "contact",
      "items",
      "purchaseDate",
      "reason",
      "condition",
      "preferredResolution",
    ],
    nextSteps: ["Provide the missing return details so we can proceed."],
    summary: text.trim().slice(0, 400),
    request: {},
  };
};

const returnWorkflow = createWorkflow(
  {
    id: "return-request-workflow",
    name: "Return Request Workflow",
    purpose: "Route and structure ecommerce return/refund requests.",
    input: z.object({
      query: z.string().min(1),
      options: z
        .object({
          userId: z.string().optional(),
          conversationId: z.string().optional(),
          enableThinking: z.boolean().optional(),
          ragMode: z.enum(["rag", "llm"]).optional(),
        })
        .optional(),
    }),
    result: z.object({
      case: returnCaseSchema,
      rawText: z.string(),
      replyText: z.string(),
    }),
  },
  andThen({
    id: "return-request-run",
    name: "退货流程",
    purpose: "Analyze a return request and output a structured case.",
    inputSchema: z.object({
      query: z.string().min(1),
      options: z
        .object({
          userId: z.string().optional(),
          conversationId: z.string().optional(),
          enableThinking: z.boolean().optional(),
          ragMode: z.enum(["rag", "llm"]).optional(),
        })
        .optional(),
    }),
    outputSchema: z.object({
      case: returnCaseSchema,
      rawText: z.string(),
      replyText: z.string(),
    }),
    execute: async ({ data }) => {
      const ragMode = data.options?.ragMode === "rag" ? "rag" : "llm";
      const enableThinking =
        typeof data.options?.enableThinking === "boolean"
          ? data.options.enableThinking
          : undefined;
      const requestHeaders =
        provider === "qwen" && enableThinking !== undefined
          ? { "x-qwen-enable-thinking": String(enableThinking) }
          : undefined;
      const skillContextPrefix = await buildSkillContextPrefix(data.query, {
        forceSkills: ["ecommerce-returns"],
      });
      const promptSections = [
        skillContextPrefix,
        "You are a return-requests agent. Analyze the user message and produce JSON only.",
        "Return JSON schema:",
        JSON.stringify(
          {
            decision: "eligible | ineligible | needs_info",
            missingFields: ["orderId", "contact", "items", "purchaseDate"],
            nextSteps: ["step 1", "step 2"],
            summary: "short summary",
            request: {
              orderId: "",
              contact: "",
              items: "",
              purchaseDate: "",
              reason: "",
              condition: "",
              preferredResolution: "refund | exchange | store credit",
            },
          },
          null,
          2
        ),
        "Constraints:",
        "- Output only JSON. No markdown or extra text.",
        "- Use needs_info when required details are missing.",
        `User Message:\n${data.query}`,
      ].filter(Boolean);
      const prompt = promptSections.join("\n\n");
      const llmResult = await agent.generateText(prompt, {
        userId: data.options?.userId,
        conversationId: data.options?.conversationId,
        headers: requestHeaders,
        context: buildToolCallContext(ragMode),
      });
      const rawText =
        typeof llmResult.text === "string" ? llmResult.text : "";
      const parsed = parseReturnCase(rawText);
      const replyPromptSections = [
        skillContextPrefix,
        "You are a customer support agent for ecommerce returns.",
        "Write a natural, friendly reply in Chinese to the user.",
        "Do not mention internal fields like summary/missingFields.",
        "If info is missing, ask concise follow-up questions in one message.",
        "Keep it short and human.",
        `User Message:\n${data.query}`,
        "Case JSON:",
        JSON.stringify(parsed, null, 2),
      ].filter(Boolean);
      const replyPrompt = replyPromptSections.join("\n\n");
      const replyResult = await agent.generateText(replyPrompt, {
        userId: data.options?.userId,
        conversationId: data.options?.conversationId,
        headers: requestHeaders,
        context: buildToolCallContext("llm"),
      });
      const replyText =
        typeof replyResult.text === "string" && replyResult.text.trim()
          ? replyResult.text.trim()
          : "";
      const yellow = "\u001b[33m";
      const reset = "\u001b[0m";
      console.log(`${yellow}[return-workflow] replyText${reset}\n${replyText}`);
      return { case: parsed, rawText, replyText };
    },
  })
);

const routingDecisionSchema = z.object({
  workflowId: z.enum(ROUTING_WORKFLOWS),
  reason: z.string(),
});

type RoutingDecision = z.infer<typeof routingDecisionSchema>;

const normalizeRoutingDecision = (payload: any): RoutingDecision => {
  const workflowId = ROUTING_WORKFLOWS.includes(payload?.workflowId)
    ? payload.workflowId
    : "local-rag-workflow";
  const reason =
    typeof payload?.reason === "string" && payload.reason.trim()
      ? payload.reason.trim()
      : "fallback";
  return { workflowId, reason };
};

const parseRoutingDecision = (text: string): RoutingDecision => {
  const payload = extractJsonPayload(text);
  if (payload) {
    try {
      const parsed = JSON.parse(payload);
      const normalized = normalizeRoutingDecision(parsed);
      const result = routingDecisionSchema.safeParse(normalized);
      if (result.success) {
        return result.data;
      }
    } catch (error) {
      console.warn("[routing-workflow] failed to parse JSON", error);
    }
  }
  return { workflowId: "local-rag-workflow", reason: "fallback" };
};

const routingWorkflow = createWorkflow(
  {
    id: "routing-workflow",
    name: "Routing Workflow",
    purpose: "Route user input to the correct workflow.",
    input: z.object({
      query: z.string().min(1),
      options: z
        .object({
          userId: z.string().optional(),
          conversationId: z.string().optional(),
          enableThinking: z.boolean().optional(),
        })
        .optional(),
    }),
    result: routingDecisionSchema,
  },
  andThen({
    id: "routing-run",
    name: "路由判断",
    purpose: "Choose a workflow id for the user request.",
    inputSchema: z.object({
      query: z.string().min(1),
      options: z
        .object({
          userId: z.string().optional(),
          conversationId: z.string().optional(),
          enableThinking: z.boolean().optional(),
        })
        .optional(),
    }),
    outputSchema: routingDecisionSchema,
    execute: async ({ data }) => {
      const enableThinking =
        typeof data.options?.enableThinking === "boolean"
          ? data.options.enableThinking
          : undefined;
      const requestHeaders =
        provider === "qwen" && enableThinking !== undefined
          ? { "x-qwen-enable-thinking": String(enableThinking) }
          : undefined;
      const promptSections = [
        "You are a routing agent. Choose the best workflow id for the user request.",
        "Allowed workflow ids:",
        ...ROUTING_WORKFLOWS.map((workflow) => `- ${workflow}`),
        "Return JSON only.",
        JSON.stringify(
          {
            workflowId: ROUTING_WORKFLOWS.join(" | "),
            reason: "short reason",
          },
          null,
          2
        ),
        `User Message:\n${data.query}`,
      ];
      const prompt = promptSections.join("\n\n");
      const llmResult = await routingAgent.generateText(prompt, {
        userId: data.options?.userId,
        conversationId: data.options?.conversationId,
        headers: requestHeaders,
        context: buildToolCallContext("llm"),
      });
      const rawText =
        typeof llmResult.text === "string" ? llmResult.text : "";
      return parseRoutingDecision(rawText);
    },
  })
);

/*
 * 对外导出的 Engine 组件：
 * - agent: 核心对话 Agent（含工具与 Guardrails）
 * - workflows: 可被 VoltAgent 服务注册的 workflow 集合
 * - localRagWorkflow: 直接暴露单个本地 RAG workflow，便于定向调用
 */
export { agent, localRagWorkflow, returnWorkflow, routingWorkflow };

export const workflows = {
  localRagWorkflow,
  returnWorkflow,
  routingWorkflow,
};
