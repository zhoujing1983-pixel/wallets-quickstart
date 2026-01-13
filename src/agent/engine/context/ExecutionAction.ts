import { FailurePolicy } from "./FailurePolicy.js";
/**
 * 单个执行动作
 * 对应一次 Tool / MCP / 内部能力调用
 */
export interface ExecutionAction {
  /**
   * 工具或执行器标识
   * e.g. "order_service", "payment_service"
   */
  tool: string;

  /**
   * 工具内的具体动作
   * e.g. "query_order", "refund"
   */
  action: string;

  /**
   * 动作参数（结构化）
   */
  params?: Record<string, any>;

  /**
   * 可选：失败处理策略
   */
  onFailure?: FailurePolicy;
}
