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

// 暴露为 VoltAgent 工具，便于 agent 在需要时显式调用。
export const localRagTool = tool({
  name: "local_rag_query",
  description:
    "Use the local SQLite-based RAG index to retrieve relevant context.",
  parameters: z.object({
    query: z.string().min(1),
  }),
  outputSchema: z.object({
    text: z.string(),
    sources: z.array(
      z.object({
        title: z.string(),
        url: z.string().optional(),
      })
    ),
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
    console.log("\n[tool:exec] local_rag_query", { query });
    const result = await runLocalRag(query);
    console.log("\n[tool:exec] local_rag_query result", {
      distance: result.distance,
      sources: result.sources.length,
    });
    return result;
  },
});
