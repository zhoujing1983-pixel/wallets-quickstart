import { createWorkflow, andThen } from "@voltagent/core";
import type { Agent } from "@voltagent/core";
import { z } from "zod";
import { buildSkillContextPrefix } from "@/agent/skills/skill-loader";
import { buildToolCallContext } from "@/agent/config/tool-call-policy";

type DirectChatWorkflowDeps = {
  agent: Agent;
  provider: string;
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
