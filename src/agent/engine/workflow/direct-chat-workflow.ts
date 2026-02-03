import { MCPConfiguration, createWorkflow, andThen } from "@voltagent/core";
import type { Agent, Tool } from "@voltagent/core";
import { z } from "zod";
import { buildSkillContextPrefix } from "@/agent/skills/skill-loader";
import { buildToolCallContext } from "@/agent/config/tool-call-policy";

type DirectChatWorkflowDeps = {
  agent: Agent;
  provider: string;
};

const weatherMcp = new MCPConfiguration({
  servers: {
    weather: {
      type: "stdio",
      command: "npx",
      args: ["tsx", "src/agent/tools/weather-mcp.ts"],
      cwd: process.cwd(),
    },
  },
});

const isWeatherIntent = (input: string): boolean => {
  const text = input.toLowerCase();
  return (
    /weather|forecast|temperature|humidity|wind|rain|snow|storm/.test(text) ||
    /天气|气温|温度|湿度|风|下雨|降雨|下雪|暴雨|雷暴|预报/.test(text)
  );
};

const logMcpWeatherResult = (output: unknown, error?: unknown) => {
  const red = "\x1b[31m";
  const reset = "\x1b[0m";
  if (error) {
    console.log(`${red}[mcp:weather] error${reset}`, error);
    return;
  }
  const payload =
    typeof output === "string" ? output : JSON.stringify(output, null, 2);
  console.log(`${red}[mcp:weather] result${reset}`, payload);
};

export const createDirectChatWorkflow = ({
  agent,
  provider,
}: DirectChatWorkflowDeps) =>
  createWorkflow(
    {
      id: "direct-chat-workflow",
      name: "Direct Chat Workflow",
      purpose: "Answer simple chat without RAG or tools.",
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
      result: z.object({
        text: z.string(),
        sources: z.array(
          z.object({
            title: z.string(),
            url: z.string().optional(),
          })
        ),
      }),
    },
    andThen({
      id: "direct-chat-run",
      name: "直接回复",
      purpose: "Answer with LLM directly.",
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
      outputSchema: z.object({
        text: z.string(),
        sources: z.array(
          z.object({
            title: z.string(),
            url: z.string().optional(),
          })
        ),
      }),
      execute: async ({ data }) => {
        const enableThinking =
          typeof data.options?.enableThinking === "boolean"
            ? data.options.enableThinking
            : undefined;
        let mcpTools: Tool<any>[] = [];
        if (isWeatherIntent(data.query)) {
          try {
            mcpTools = await weatherMcp.getTools();
          } catch (error) {
            console.warn(
              "[direct-chat-workflow] failed to load MCP tools",
              error
            );
          }
        }
        const requestHeaders =
          provider === "qwen" && enableThinking !== undefined
            ? { "x-qwen-enable-thinking": String(enableThinking) }
            : undefined;
        const skillContextPrefix = await buildSkillContextPrefix(data.query);
        const prompt = skillContextPrefix
          ? `${skillContextPrefix}\n\n${data.query}`
          : data.query;
        const llmResult = await agent.generateText(prompt, {
          userId: data.options?.userId,
          conversationId: data.options?.conversationId,
          headers: requestHeaders,
          tools: mcpTools,
          hooks: {
            onToolEnd: ({ tool, output, error }) => {
              if (tool?.name?.startsWith("city-weather_")) {
                logMcpWeatherResult(output, error);
              }
            },
          },
          context: buildToolCallContext("llm"),
        });
        const text =
          typeof llmResult.text === "string" && llmResult.text.trim()
            ? llmResult.text.trim()
            : "I did not get a response. Please try again.";
        return {
          text,
          sources: [],
        };
      },
    }),
  );
