/*
 * 文件作用：引擎聚合出口：统一导出 workflow 构建函数，供 voltagent-engine 装配使用。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/voltagent-engine.ts::import { create*Workflow }；下游：src/agent/engine/workflow/*.ts::create*Workflow()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
export { createFlightBookingWorkflow } from "@/agent/engine/workflow/flight-booking-workflow";
export { createDirectChatWorkflow } from "@/agent/engine/workflow/direct-chat-workflow";
export { createLocalRagWorkflow } from "@/agent/engine/workflow/local-rag-workflow";
export { createReturnWorkflow } from "@/agent/engine/workflow/return-workflow";
export { createRoutingWorkflow } from "@/agent/engine/workflow/routing-workflow";