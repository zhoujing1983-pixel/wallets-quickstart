/*
 * 文件作用：VoltAgent 业务工作流定义：描述每类业务（路由/闲聊/机票/RAG/退货）的步骤与执行策略。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/voltagent-engine.ts::createDirectChatWorkflow(...)；下游：src/agent/tools/weather-mcp.ts（MCP 工具调用）与 agent.generateText()/streamText()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
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
  const yellow = "\x1b[33m";
  const reset = "\x1b[0m";
  if (error) {
    console.log(`${yellow}[mcp:weather] error${reset}`, error);
    return;
  }
  const payload =
    typeof output === "string" ? output : JSON.stringify(output, null, 2);
  console.log(`${yellow}[mcp:weather] result${reset}`, payload);
};

const parseWeatherToolPayload = (output: unknown) => {
  if (!output) return null;
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (record.structuredContent && typeof record.structuredContent === "object") {
      return record.structuredContent as Record<string, unknown>;
    }
  }
  if (Array.isArray(output)) {
    const first = output[0] as any;
    if (first?.type === "text" && typeof first.text === "string") {
      try {
        return JSON.parse(first.text) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  if (typeof output === "string") {
    try {
      return JSON.parse(output) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
};

const LOW_GRANULARITY_FEATURE_CODES = new Set([
  "PPL",
  "PPLL",
  "PPLS",
  "PPLX",
  "PPLF",
  "PPLG",
  "PPLH",
  "PPLQ",
  "PPLR",
  "PPLW",
  "PPLZ",
]);

const hasLocationQualifier = (text: string) =>
  /省|市|自治区|自治州|特别行政区|地区|盟|州|县|区|镇|乡|村/.test(text);

const shouldAskForMoreLocation = (
  query: string,
  geocode?: Record<string, unknown>,
) => {
  if (!geocode || typeof geocode !== "object") {
    return false;
  }
  const admin1 = typeof geocode.admin1 === "string" ? geocode.admin1 : "";
  const admin2 = typeof geocode.admin2 === "string" ? geocode.admin2 : "";
  const country = typeof geocode.country === "string" ? geocode.country : "";
  const featureCode =
    typeof geocode.featureCode === "string" ? geocode.featureCode : "";

  const queryHasQualifier = hasLocationQualifier(query);
  const queryHasAdmin =
    (admin1 && query.includes(admin1)) ||
    (admin2 && query.includes(admin2)) ||
    (country && query.includes(country));

  if (featureCode && LOW_GRANULARITY_FEATURE_CODES.has(featureCode)) {
    return !queryHasQualifier && !queryHasAdmin;
  }
  if (!queryHasQualifier && !queryHasAdmin && admin1 && admin2) {
    return true;
  }
  return false;
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
        let clarificationMessage = "";
        let lastGeocode: Record<string, unknown> | null = null;
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
          tools: mcpTools, //不显式传 toolChoice，默认就是 auto（工具调用可选，由模型自行决定）。
          // 用于强制每次调用 MCP（开启后将绕过 auto，固定调用天气工具）
          // toolChoice: isWeatherIntent(data.query)
          //   ? { type: "tool", toolName: "weather_get_weather_by_city" }
          //   : undefined,
          hooks: {
            onToolEnd: ({ tool, output, error }) => {
              if (tool?.name?.startsWith("weather_")) {
                logMcpWeatherResult(output, error);
                const payload = parseWeatherToolPayload(output);
                const geocode = payload?.geocode as
                  | Record<string, unknown>
                  | undefined;
                lastGeocode = geocode ?? null;
              }
            },
          },
          context: buildToolCallContext("llm"),
        });
        if (shouldAskForMoreLocation(data.query, lastGeocode ?? undefined)) {
          clarificationMessage =
            "检测到地名可能存在歧义或粒度过细，请补充完整地名（如“省+市/区/县”），我再为你查询。";
        }
        if (clarificationMessage) {
          const hint = `**${clarificationMessage}**`;
          const combined = llmResult?.text?.trim()
            ? `${hint}\n\n${llmResult.text.trim()}`
            : hint;
          return { text: combined, sources: [] };
        }
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