import {
  Agent,
  Memory,
  VoltAgent,
  tool,
  createOutputGuardrail,
} from "@voltagent/core";
import { honoServer } from "@voltagent/server-hono";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import "dotenv/config";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { resumeToPipeableStream } from "react-dom/server";
import type {
  TextUIPart,
  UIDataTypes,
  UIMessage,
  UIMessagePart,
  UITools,
} from "ai";

// Tool to fetch and sanitize website content for summaries.
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
          setTimeout(resolve, 500 * (attempt + 1))
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
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`
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

const memoryUrl = process.env.VOLTAGENT_MEMORY_URL ?? "file:./agent-memory.db";
const memory = new Memory({
  storage: new LibSQLMemoryAdapter({ url: memoryUrl }),
});
console.log(`[memory] persisting conversations at ${memoryUrl}`);

const memoryAny = memory as Memory & Record<string, any>;
const stripNoThinkFromText = (text: string) =>
  text.replace(/\s*\/no_think\b/g, "").trim();

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
      ])
    );
  };
  return walk(value, 0);
};

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
      }
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

// Build a safe, structured log entry for an LLM request.
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
    message: Record<string, unknown> | undefined
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

const normalizeReasonFromMessage = (
  message: Record<string, unknown> | undefined
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

const REASONING_CONTEXT_KEY = Symbol("voltagent:reasoning");

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

const THINK_TAG_REGEX =
  /<\s*(?:think|reason)[^>]*>[\s\S]*?<\/\s*(?:think|reason)\s*>/gi;
const stripThinkTags = (text: string) =>
  text.replace(THINK_TAG_REGEX, "").trim();

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

const isTextPart = (
  part?: UIMessagePart<UIDataTypes, UITools>
): part is TextUIPart => Boolean(part && part.type === "text");

const hasReasonPart = (parts?: UIMessage["parts"]) =>
  Boolean(
    parts?.some((part) => isTextPart(part) && part.text.includes("<reason>"))
  );

const withReasonMessage = (
  message: UIMessage,
  reasoning: string
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

const originalSaveMessageWithContext =
  memory.saveMessageWithContext.bind(memory);
memory.saveMessageWithContext = async function (
  message: SaveMessageWithContextArgs[0],
  userId: SaveMessageWithContextArgs[1],
  conversationId: SaveMessageWithContextArgs[2],
  context: SaveMessageWithContextArgs[3],
  operationContext: SaveMessageWithContextArgs[4]
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
    operationContext
  );
};

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
  init?: RequestInit
) => {
  const entry = buildLogEntry(input, init);
  if (!entry) {
    return;
  }
  console.log(`\n[llm:request] ${label}`);
  console.dir(entry, { depth: null });
};

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
      { depth: null }
    );
  } catch {
    // Ignore response logging failures.
  }
};

const readHeaderValue = (
  headers: HeadersInit | undefined,
  name: string
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

const parseEnableThinkingHeader = (
  headers: HeadersInit | undefined
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

// Create a fetch wrapper that logs requests and optionally rewrites bodies.
const createLoggedFetch = (
  label: string,
  transformBody?: (body: string, init?: RequestInit) => string,
  options?: { logResponse?: boolean }
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
            typeof part?.text === "string" && part.text.includes("/no_think")
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

const parseOptionalNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

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
        enableThinking
      );
    },
    { logResponse: true }
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
  process.env.LM_STUDIO_TEMPERATURE
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
const agent = new Agent({
  name: "FinyxWaaSAgent",
  instructions,
  model,
  temperature: provider === "lmstudio" ? lmStudioTemperature ?? 0.7 : undefined,
  maxOutputTokens:
    provider === "lmstudio" ? lmStudioMaxOutputTokens : undefined,
  tools: [fetchWebsiteTool],
  memory,
  outputGuardrails: [reasoningInjectionGuardrail],
  hooks: {
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

// Flag for local CLI debug mode.
const isLocalDebug = process.argv.includes("--local");

if (isLocalDebug) {
  // Readline interface for local prompt input.
  const rl = readline.createInterface({ input, output });
  console.log(
    "Local debug mode. Type your prompt and press Enter. Ctrl+C to exit."
  );
  rl.on("line", async (line) => {
    // Trimmed user prompt from stdin.
    const prompt = line.trim();
    if (!prompt) {
      return;
    }
    await agent.generateText(prompt);
    rl.prompt();
  });
  rl.prompt();
} else {
  new VoltAgent({
    agents: { localAgent: agent },
    server: honoServer({
      port: 3141,
      enableSwaggerUI: true,
    }),
  });
  const serverPrompt = process.env.VOLTAGENT_SERVER_PROMPT?.trim();
  if (serverPrompt) {
    void (async () => {
      try {
        await agent.generateText(serverPrompt);
      } catch (error) {
        console.error("[server:prompt] failed", error);
      }
    })();
  }
}
