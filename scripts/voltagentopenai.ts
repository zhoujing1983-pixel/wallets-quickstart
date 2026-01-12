import { Agent, Memory, VoltAgent, tool } from "@voltagent/core";
import { honoServer } from "@voltagent/server-hono";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import "dotenv/config";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";

// Tool to fetch and sanitize website content for summaries.
const fetchWebsiteTool = tool({
  name: "fetch_website_content",
  description: "Fetch raw text content from a URL for summarization or analysis.",
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
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!response) {
      throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
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
    const content =
      contentType.includes("text/html")
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
  if (typeof value === "string") {
    return stripNoThinkFromText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripNoThinkFromValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        stripNoThinkFromValue(val),
      ])
    );
  }
  return value;
};

const wrapMemoryMethod = (name: string) => {
  const original = memoryAny[name]?.bind(memory);
  if (typeof original !== "function") {
    return;
  }
  memoryAny[name] = async (...args: unknown[]) => {
    const sanitizedArgs = args.map(stripNoThinkFromValue);
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

// Build a safe, structured log entry for an LLM request.
const buildLogEntry = (input: RequestInfo | URL, init?: RequestInit) => {
  if (!init?.body) {
    return null;
  }
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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

// Print a redacted LLM request payload to logs.
const logLLMRequest = (label: string, input: RequestInfo | URL, init?: RequestInit) => {
  const entry = buildLogEntry(input, init);
  if (!entry) {
    return;
  }
  console.log(`\n[llm:request] ${label}`);
  console.dir(entry, { depth: null });
};

// Create a fetch wrapper that logs requests and optionally rewrites bodies.
const createLoggedFetch = (
  label: string,
  transformBody?: (body: string) => string,
): typeof fetch => {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string" && transformBody) {
      try {
        const nextBody = transformBody(init.body);
        const nextInit = { ...init, body: nextBody };
        logLLMRequest(label, input, nextInit);
        return fetch(input, nextInit);
      } catch {
        // Fall back to default logging below.
      }
    }
    logLLMRequest(label, input, init);
    return fetch(input, init);
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
  fetch: createLoggedFetch("qwen", rewriteDeveloperRole),
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
const lmStudioTemperature = parseOptionalNumber(process.env.LM_STUDIO_TEMPERATURE);
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
    onStepFinish: ({ step }) => {
      if (step?.type === "text" && step?.role === "assistant") {
        console.log("\n[llm]", step.content);
      }
    },
  },
});

// Flag for local CLI debug mode.
const isLocalDebug = process.argv.includes("--local");

if (isLocalDebug) {
  // Readline interface for local prompt input.
  const rl = readline.createInterface({ input, output });
  console.log("Local debug mode. Type your prompt and press Enter. Ctrl+C to exit.");
  rl.on("line", async (line) => {
    // Trimmed user prompt from stdin.
    const prompt = line.trim();
    if (!prompt) {
      return;
    }
    // LLM output for the prompt.
    const result = await agent.generateText(prompt);
    console.log("\n[final]", result.text);
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
}
