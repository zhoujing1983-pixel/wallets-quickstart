import { createWorkflow, andThen } from "@voltagent/core";
import type { Agent } from "@voltagent/core";
import { z } from "zod";
import { ROUTING_WORKFLOWS } from "@/agent/config/routing-config";
import { buildToolCallContext } from "@/agent/config/tool-call-policy";

type RoutingWorkflowDeps = {
  routingAgent: Agent;
  provider: string;
};

// 路由决策 JSON schema。
const routingDecisionSchema = z.object({
  // 选择的 workflow id。
  workflowId: z.enum(ROUTING_WORKFLOWS),
  // 选择原因说明。
  reason: z.string(),
  // 若为简单对话，可直接返回回复文本。
  directText: z.string().optional(),
});

// 路由决策类型定义。
type RoutingDecision = z.infer<typeof routingDecisionSchema>;

// 从文本中提取 JSON 段（支持 fenced code 或最外层花括号）。
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

// 归一化路由决策，确保 workflowId 在允许范围内。
const normalizeRoutingDecision = (payload: any): RoutingDecision => {
  const workflowId = ROUTING_WORKFLOWS.includes(payload?.workflowId)
    ? payload.workflowId
    : "local-rag-workflow";
  const reason =
    typeof payload?.reason === "string" && payload.reason.trim()
      ? payload.reason.trim()
      : "fallback";
  const directText =
    typeof payload?.directText === "string" && payload.directText.trim()
      ? payload.directText.trim()
      : undefined;
  return { workflowId, reason, directText };
};

// 解析路由决策 JSON；失败则回退默认 workflow。
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

export const createRoutingWorkflow = ({
  routingAgent,
  provider,
}: RoutingWorkflowDeps) =>
  createWorkflow(
    {
      id: "routing-workflow",
      name: "Routing Workflow",
      purpose: "Route user input to the correct workflow.",
      input: z.object({
        // 用户查询内容。
        query: z.string().min(1),
        options: z
          .object({
            // 用户标识（用于记忆/上下文）。
            userId: z.string().optional(),
            // 会话标识（用于连续对话）。
            conversationId: z.string().optional(),
            // 是否启用模型推理（Qwen 可用）。
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
        // 用户查询内容。
        query: z.string().min(1),
        options: z
          .object({
            // 用户标识（用于记忆/上下文）。
            userId: z.string().optional(),
            // 会话标识（用于连续对话）。
            conversationId: z.string().optional(),
            // 是否启用模型推理（Qwen 可用）。
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
          "If this is simple small talk, reply with a direct response in JSON.",
          "Otherwise, choose a workflow id.",
          "Return JSON only.",
          JSON.stringify(
            {
              workflowId: ROUTING_WORKFLOWS.join(" | "),
              reason: "short reason",
              directText: "optional reply for simple chat",
            },
            null,
            2,
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
    }),
  );
