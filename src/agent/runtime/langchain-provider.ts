import type {
  AgentWorkflowRuntime,
  WorkflowPayload,
  WorkflowResponse,
} from "@/agent/runtime/types";

// LangChain workflow 服务地址，默认独立监听 3142 端口。
const LANGCHAIN_BASE_URL =
  process.env.LANGCHAIN_BASE_URL?.trim() || "http://localhost:3142";

/**
 * 创建 LangChain 运行时适配器。
 * - 职责：把统一 workflow 调用转发到 LangChain 独立服务；
 * - 与 VoltAgent provider 保持同一返回契约，便于开关切换。
 */
export const createLangChainRuntime = (): AgentWorkflowRuntime => ({
  /**
   * 执行指定 workflow。
   * @param workflowId 工作流 ID
   * @param payload 标准化工作流输入
   * @returns LangChain server 返回的标准响应
   */
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
});
