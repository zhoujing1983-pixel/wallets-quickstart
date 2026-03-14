import type { AgentWorkflowRuntime, WorkflowPayload, WorkflowResponse } from "@/agent/runtime/types";

// VoltAgent workflow 服务地址（与现有 3141 端口约定保持兼容）。
const VOLTAGENT_BASE_URL =
  process.env.VOLTAGENT_BASE_URL?.trim() || "http://localhost:3141";

/**
 * 创建 VoltAgent 运行时适配器。
 * - 职责：把统一的 workflow 调用转发到 VoltAgent HTTP 接口；
 * - 失败时抛出统一错误，让上层路由处理重试或降级。
 */
export const createVoltagentRuntime = (): AgentWorkflowRuntime => ({
  /**
   * 执行指定 workflow。
   * @param workflowId 工作流 ID（如 routing-workflow）
   * @param payload 标准化工作流输入
   * @returns VoltAgent 返回的标准响应结构
   */
  executeWorkflow: async (
    workflowId: string,
    payload: WorkflowPayload
  ): Promise<WorkflowResponse> => {
    const res = await fetch(
      `${VOLTAGENT_BASE_URL}/workflows/${workflowId}/execute`,
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
