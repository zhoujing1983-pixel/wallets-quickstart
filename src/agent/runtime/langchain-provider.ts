/*
 * 文件作用：LangChain provider 适配层：把统一 runtime 调用转发到 LangChain server HTTP 接口。
 * 调用链阶段：运行时传输阶段（统一调用 -> HTTP）
 * 调用链关系：上游：src/agent/runtime/factory.ts::runtime.executeWorkflow()/executeWorkflowStream()；下游：scripts/langchain-server.ts::POST /workflows/:id/execute(/stream)。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import type {
  AgentWorkflowRuntime,
  WorkflowPayload,
  WorkflowResponse,
} from "@/agent/runtime/types";

// LangChain workflow 服务地址，默认独立监听 3142 端口。
const LANGCHAIN_BASE_URL =
  process.env.LANGCHAIN_BASE_URL?.trim() || "http://localhost:3142";

// 创建 LangChain 运行时适配器。
// 说明：这里不是“父类 override”，而是“按 AgentWorkflowRuntime 接口契约提供实现”。
// AgentWorkflowRuntime 只定义方法签名，不提供默认实现。
export const createLangChainRuntime = (): AgentWorkflowRuntime => ({
  // 非流式 workflow 执行：调用 /workflows/:id/execute。
  executeWorkflow: async (
    workflowId: string,
    payload: WorkflowPayload
  ): Promise<WorkflowResponse> => {
    const res = await fetch(
      `${LANGCHAIN_BASE_URL}/workflows/${workflowId}/execute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = (await res.json()) as WorkflowResponse;
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || "Workflow request failed.");
    }
    return data;
  },
  // 流式 workflow 执行：调用 /workflows/:id/execute/stream。
  // 该方法在接口里是可选项（executeWorkflowStream?），LangChain 这里选择实现。
  executeWorkflowStream: async (
    workflowId: string,
    payload: WorkflowPayload
  ): Promise<Response> => {
    const res = await fetch(
      `${LANGCHAIN_BASE_URL}/workflows/${workflowId}/execute/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      let message = "Workflow stream request failed.";
      try {
        const data = await res.json();
        if (data?.error && typeof data.error === "string") {
          message = data.error;
        }
      } catch {
        // Ignore non-JSON error body.
      }
      throw new Error(message);
    }
    return res;
  },
});