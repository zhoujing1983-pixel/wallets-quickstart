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
