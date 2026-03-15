/*
 * 文件作用：VoltAgent workflow 执行器：集中封装 /workflows/:id/execute 调用，隔离 provider 与传输细节。
 * 调用链阶段：运行时传输阶段（统一调用 -> HTTP）
 * 调用链关系：上游：src/agent/runtime/voltagent-provider.ts::executeWorkflow()；下游：VoltAgent Server /workflows/:id/execute（由 scripts/voltagentopenai.ts 启动）。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import type { WorkflowPayload, WorkflowResponse } from "@/agent/runtime/types";

// VoltAgent workflow 服务地址（与现有 3141 端口约定保持兼容）。
const VOLTAGENT_BASE_URL =
  process.env.VOLTAGENT_BASE_URL?.trim() || "http://localhost:3141";

/**
 * 执行指定 VoltAgent workflow。
 * - 当前实现为 HTTP 调用；
 * - 后续可在此处平滑切换为同进程直调而不影响 provider 层。
 */
export const executeVoltagentWorkflow = async (
  workflowId: string,
  payload: WorkflowPayload,
): Promise<WorkflowResponse> => {
  const res = await fetch(
    `${VOLTAGENT_BASE_URL}/workflows/${workflowId}/execute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const data = (await res.json()) as WorkflowResponse;
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Workflow request failed.");
  }
  return data;
};