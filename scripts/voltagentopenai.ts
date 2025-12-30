import { Agent, VoltAgent, tool } from "@voltagent/core";
import { honoServer } from "@voltagent/server-hono";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import "dotenv/config";

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
    const maxRetries = 2;
    const timeoutMs = 15000;
    let lastError: unknown;
    let response: Response | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
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

    const contentType = response.headers.get("content-type") ?? "";
    const rawText = await response.text();
    console.log("\n[tool:exec] fetch_website_content response", {
      contentType,
      status: response.status,
    });
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

const openaiProvider = createOpenAI({
  // Ollama's OpenAI-compatible endpoint
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

const googleProvider = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const instructions = process.env.VOLTAGENT_INSTRUCTIONS?.trim();

if (!instructions) {
  throw new Error("Missing VOLTAGENT_INSTRUCTIONS in .env");
}else {
  console.log("Loaded VOLTAGENT_INSTRUCTIONS:");
  console.log(instructions);
}

const provider = (process.env.MODEL_PROVIDER ?? "ollama").toLowerCase();

if (provider === "google" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY in .env");
}

const model =
  provider === "google"
    ? googleProvider(process.env.GOOGLE_MODEL ?? "gemini-1.5-flash")
    : openaiProvider.chat(process.env.OLLAMA_MODEL ?? "llama3.2:1b");

const agent = new Agent({
  name: "Finyx WaaS Agent",
  instructions,
  model,
  // temperature: 0,
  tools: [fetchWebsiteTool],
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

const isLocalDebug = process.argv.includes("--local");

if (isLocalDebug) {
  const rl = readline.createInterface({ input, output });
  console.log("Local debug mode. Type your prompt and press Enter. Ctrl+C to exit.");
  rl.on("line", async (line) => {
    const prompt = line.trim();
    if (!prompt) {
      return;
    }
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
