import { createWorkflow, andThen } from "@voltagent/core";
import type { Agent } from "@voltagent/core";
import { z } from "zod";
import { buildSkillContextPrefix } from "@/agent/skills/skill-loader";
import { buildToolCallContext } from "@/agent/config/tool-call-policy";

type ReturnWorkflowDeps = {
  agent: Agent;
  provider: string;
};

// 退货请求结构化 JSON schema。
const returnCaseSchema = z.object({
  // 退货请求是否满足条件。
  decision: z.enum(["eligible", "ineligible", "needs_info"]),
  // 当前缺失的字段列表。
  missingFields: z.array(z.string()),
  // 下一步处理建议。
  nextSteps: z.array(z.string()),
  // 简要摘要。
  summary: z.string(),
  // 结构化用户请求信息。
  request: z.object({
    // 订单号（可选）。
    orderId: z.string().optional(),
    // 联系方式（可选）。
    contact: z.string().optional(),
    // 退货商品信息（可选）。
    items: z.string().optional(),
    // 购买日期（可选）。
    purchaseDate: z.string().optional(),
    // 退货原因（可选）。
    reason: z.string().optional(),
    // 商品状态/成色（可选）。
    condition: z.string().optional(),
    // 期望处理方式（可选）。
    preferredResolution: z.string().optional(),
  }),
});

// 退货 case 的类型定义。
type ReturnCase = z.infer<typeof returnCaseSchema>;

// 将未知数组输入规范化为 string[]。
const coerceStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : String(item)))
        .filter(Boolean)
    : [];

// 将模型输出归一化为 ReturnCase 结构。
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

// 解析并校验 ReturnCase；失败时返回兜底结构。
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

export const createReturnWorkflow = ({ agent, provider }: ReturnWorkflowDeps) =>
  createWorkflow(
    {
      id: "return-request-workflow",
      name: "Return Request Workflow",
      purpose: "Route and structure ecommerce return/refund requests.",
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
            needRag: z.boolean().optional(),
            useLlmSummary: z.boolean().optional(),
          })
          .optional(),
      }),
      result: z.object({
        // 结构化退货 case。
        case: returnCaseSchema,
        // 原始模型输出文本。
        rawText: z.string(),
        // 面向用户的回复文本。
        replyText: z.string(),
      }),
    },
    andThen({
      id: "return-request-run",
      name: "退货流程",
      purpose: "Analyze a return request and output a structured case.",
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
            needRag: z.boolean().optional(),
            useLlmSummary: z.boolean().optional(),
          })
          .optional(),
      }),
      outputSchema: z.object({
        // 结构化退货 case。
        case: returnCaseSchema,
        // 原始模型输出文本。
        rawText: z.string(),
        // 面向用户的回复文本。
        replyText: z.string(),
      }),
      execute: async ({ data }) => {
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
            2,
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
          context: buildToolCallContext("llm"),
        });
        const rawText = typeof llmResult.text === "string" ? llmResult.text : "";
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
    }),
  );
