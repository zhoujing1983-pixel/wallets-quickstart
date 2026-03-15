/*
 * 文件作用：路由 Agent 适配层：封装路由判定策略与模型交互，输出 workflow 选择建议。
 * 调用链阶段：路由与编排阶段（API 入站后）
 * 调用链关系：上游：src/agent/engine/voltagent-engine.ts::createRoutingWorkflow(...)；下游：src/agent/engine/workflow/routing-workflow.ts::createRoutingWorkflow()（消费 createRoutingAgent() 输出）。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { Agent } from "@voltagent/core";

export const createRoutingAgent = (
  model: ConstructorParameters<typeof Agent>[0]["model"]
) =>
  new Agent({
    name: "RoutingAgent",
    instructions:
      "You are a routing agent. Choose the best workflow id for the user request.",
    model,
    temperature: 0,
  });