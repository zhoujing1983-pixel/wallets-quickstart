import { createWorkflow, andThen } from "@voltagent/core";
import type { Agent } from "@voltagent/core";
import { z } from "zod";
import { runLocalRag } from "@/agent/tools/local-rag-tool";
import { buildSkillContextPrefix } from "@/agent/skills/skill-loader";
import { buildToolCallContext } from "@/agent/config/tool-call-policy";

type LocalRagWorkflowDeps = {
  agent: Agent;
  provider: string;
};

export const createLocalRagWorkflow = ({
  agent,
  provider,
}: LocalRagWorkflowDeps) =>
  createWorkflow(
    {
      id: "local-rag-workflow",
      name: "Local RAG Workflow",
      purpose: "Run local RAG retrieval and optionally fall back to LLM.",
      input: z.object({
        // 用户查询内容。
        query: z.string().min(1),
        options: z
          .object({
            // 是否启用本地 RAG 检索。
            needRag: z.boolean().optional(),
            // 是否用 LLM 对检索结果做 summary。
            useLlmSummary: z.boolean().optional(),
            // 用户标识（用于记忆/上下文）。
            userId: z.string().optional(),
            // 会话标识（用于连续对话）。
            conversationId: z.string().optional(),
            // 是否启用模型推理（Qwen 可用）。
            enableThinking: z.boolean().optional(),
          })
          .optional(),
      }),
      result: z.object({
        // 最终回答文本。
        text: z.string(),
        // 参考来源列表。
        sources: z.array(
          z.object({
            // 来源标题。
            title: z.string(),
            // 来源 URL（可选）。
            url: z.string().optional(),
          }),
        ),
        // 召回打分（可为空）。
        score: z.number().nullable(),
        // 向量距离（可为空）。
        distance: z.number().nullable(),
        snippets: z
          .array(
            z.object({
              title: z.string(),
              url: z.string().optional(),
              content: z.string(),
              score: z.number().nullable().optional(),
              distance: z.number().nullable().optional(),
            })
          )
          .optional(),
      }),
    },
    andThen({
      id: "local-rag-retrieve",
      name: "本地RAG检索与回退",
      purpose: "优先本地RAG，必要时回退到Agent生成。",
      inputSchema: z.object({
        // 用户查询内容。
        query: z.string().min(1),
        options: z
          .object({
            // 是否启用本地 RAG 检索。
            needRag: z.boolean().optional(),
            // 是否用 LLM 对检索结果做 summary。
            useLlmSummary: z.boolean().optional(),
            // 用户标识（用于记忆/上下文）。
            userId: z.string().optional(),
            // 会话标识（用于连续对话）。
            conversationId: z.string().optional(),
            // 是否启用模型推理（Qwen 可用）。
            enableThinking: z.boolean().optional(),
          })
          .optional(),
      }),
      outputSchema: z.object({
        // 最终回答文本。
        text: z.string(),
        // 参考来源列表。
        sources: z.array(
          z.object({
            // 来源标题。
            title: z.string(),
            // 来源 URL（可选）。
            url: z.string().optional(),
          }),
        ),
        // 召回打分（可为空）。
        score: z.number().nullable(),
        // 向量距离（可为空）。
        distance: z.number().nullable(),
        snippets: z
          .array(
            z.object({
              title: z.string(),
              url: z.string().optional(),
              content: z.string(),
              score: z.number().nullable().optional(),
              distance: z.number().nullable().optional(),
            })
          )
          .optional(),
      }),
      execute: async ({ data }) => {
        try {
        const skillContextPrefix = await buildSkillContextPrefix(data.query);
        // 组合用户问题与技能上下文。
        const buildUserPrompt = (query: string) =>
          skillContextPrefix
            ? `${skillContextPrefix}\n\nUser Question:\n${query}`
            : query;
        const mode = process.env.AGENT_PROXY_MODE ?? "local-rag";
        const envNeedRag =
          (process.env.NEED_RAG ?? "true").toLowerCase() !== "false";
        const needRag =
          typeof data.options?.needRag === "boolean"
            ? data.options.needRag
            : envNeedRag;
        const useLlmSummary =
          typeof data.options?.useLlmSummary === "boolean"
            ? data.options.useLlmSummary
            : (process.env.LOCAL_RAG_USE_LLM_SUMMARY ?? "").toLowerCase() !==
              "false";
        const yellow = "\u001b[33m";
        const reset = "\u001b[0m";
        console.log(
          `${yellow}[rag-flow] 当前分支判断${reset}`,
          JSON.stringify({ needRag, useLlmSummary, proxyMode: mode }),
        );
        /*
         * 本地 RAG + LLM 拼接开关：
         * - LOCAL_RAG_USE_LLM_SUMMARY 默认开启（除非显式设为 false）；
         * - 开启时：RAG 命中则作为上下文提示词给 LLM，总结/润色；
         * - 关闭时：命中就直接返回 RAG 结果，不再走 LLM。
         */
        const enableSummary = useLlmSummary;
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
        if (needRag && (mode === "local-rag" || mode === "hybrid")) {
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
                      const content =
                        typeof snippet.content === "string"
                          ? snippet.content
                          : "";
                      return `${index + 1}) ${content}`;
                    })
                    .join("\n\n")
                : contextSnippet;
              const contextLines = [
                "你是一个基于检索内容回答问题的助手。",
                "规则：只使用 Context 中的信息作答；禁止编造或补充未出现的事实。",
                "若 Context 不能回答问题，请直接回答“不知道”。",
                "回答要求：简洁明了，必要时做总结/润色；不要在答案末尾生成引用编号。",
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
                // 注入 ragMode 到上下文（仅用于策略占位）。
                context: buildToolCallContext("rag"),
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
                snippets: ragResult.snippets,
              };
            }
            // 未命中就让 LLM 直接思考回答。
            const llmResult = await agent.generateText(
              buildUserPrompt(data.query),
              {
                userId: data.options?.userId,
                conversationId: data.options?.conversationId,
                headers: requestHeaders,
                // 注入 ragMode 到上下文（仅用于策略占位）。
                context: buildToolCallContext("rag"),
              },
            );
            const text =
              typeof llmResult.text === "string" && llmResult.text.trim()
                ? llmResult.text
                : "I did not get a response. Please try again.";
            return {
              text,
              sources: [],
              score: null,
              distance: null,
              snippets: [],
            };
          }
          // 关闭 LLM 拼接时，如果未命中且处于 hybrid，则回退到 LLM。
          const shouldFallback = mode === "hybrid" && !isAnswer;
          if (!shouldFallback) {
            return ragResult;
          }
        }
        // needRag=false 或非 RAG 模式时，直接走 LLM。
        const llmResult = await agent.generateText(buildUserPrompt(data.query), {
          userId: data.options?.userId,
          conversationId: data.options?.conversationId,
          headers: requestHeaders,
          // 注入 ragMode 到上下文（仅用于策略占位）。
          context: buildToolCallContext("llm"),
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
          snippets: [],
        };
        } catch (error) {
          console.error("[rag-flow] workflow failed", error);
          return {
            text: "本地检索暂时不可用，请稍后再试。",
            sources: [],
            score: null,
            distance: null,
          };
        }
      },
    }),
  );
