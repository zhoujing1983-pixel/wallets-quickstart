import { tool } from "@voltagent/core";
import { z } from "zod";
import { queryLocalRag } from "@/agent/retrievers/RAG-local-retriever";

/*
 * 本地 RAG 工具文件：
 * - 统一封装本地 RAG 检索逻辑，便于 Agent 或 workflow 复用；
 * - 工具本身可被 Agent 调用；
 * - runLocalRag 作为轻量函数，供 workflow 直接使用（不依赖模型调用）。
 */

// 直接调用本地 RAG 查询，作为 workflow 与工具的共享实现。
export const runLocalRag = async (query: string) => {
  return queryLocalRag(query);
};

/*
 * 暴露为 VoltAgent 工具：
 * - name/description 用于工具路由与提示词；
 * - parameters/outputSchema 明确输入输出结构，便于模型理解；
 * - execute 内部记录日志，便于观察检索耗时与命中情况。
 */
export const localRagTool = tool({
  name: "local_rag_query",
  description:
    "Use the local SQLite-based RAG index to retrieve relevant context.",
  parameters: z.object({
    // 查询语句：非空字符串。
    query: z.string().min(1),
  }),
  outputSchema: z.object({
    // 汇总后的短回答。
    text: z.string(),
    // 命中的来源列表。
    sources: z.array(
      z.object({
        title: z.string(),
        url: z.string().optional(),
      })
    ),
    // 最近的距离分数，无法判定时为 null。
    distance: z.number().nullable(),
    // 多片段返回，便于按编号引用。
    snippets: z
      .array(
        z.object({
          title: z.string(),
          url: z.string().optional(),
          content: z.string(),
          distance: z.number(),
        })
      )
      .optional(),
  }),
  execute: async ({ query }) => {
    // 记录工具调用输入，便于审计与调试。
    console.log("\n[tool:exec] local_rag_query", { query });
    const result = await runLocalRag(query);
    // 记录基础统计信息，避免日志过大。
    console.log("\n[tool:exec] local_rag_query result", {
      distance: result.distance,
      sources: result.sources.length,
    });
    return result;
  },
});
