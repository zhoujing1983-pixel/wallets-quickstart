/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { FailurePolicy } from "./FailurePolicy.js";

/**
 * ExecutionAction：
 * - 单个执行动作；
 * - 对应一次 Tool / MCP / 内部能力调用；
 * - 由 Planner 生成，供 Engine 调度。
 */
export interface ExecutionAction {
  /**
   * 工具或执行器标识：
   * - 用于路由到具体实现；
   * - e.g. "order_service", "payment_service"
   */
  tool: string;

  /**
   * 工具内的具体动作：
   * - 指向具体 API / 操作；
   * - e.g. "query_order", "refund"
   */
  action: string;

  /**
   * 动作参数（结构化）：
   * - 由 Planner 生成；
   * - Engine 透传给执行器。
   */
  params?: Record<string, any>;

  /**
   * 可选：失败处理策略：
   * - 覆盖全局策略；
   * - 支持中止/忽略/回滚。
   */
  onFailure?: FailurePolicy;
}