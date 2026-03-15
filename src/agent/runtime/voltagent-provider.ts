/*
 * 文件作用：VoltAgent provider 适配层：把统一 runtime 调用转发到 VoltAgent server HTTP 接口。
 * 调用链阶段：运行时传输阶段（统一调用 -> HTTP）
 * 调用链关系：上游：src/agent/runtime/factory.ts::runtime.executeWorkflow()；下游：src/agent/runtime/voltagent-executor.ts::executeVoltagentWorkflow()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import type { AgentWorkflowRuntime, WorkflowPayload, WorkflowResponse } from "@/agent/runtime/types";
import { executeVoltagentWorkflow } from "@/agent/runtime/voltagent-executor";

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
  ): Promise<WorkflowResponse> =>
    executeVoltagentWorkflow(workflowId, payload),
});