import { ExecutionAction } from "./ExecutionAction.js";

/*
 * FailurePolicy：
 * - 定义执行失败后的兜底策略；
 * - 由 Planner 或上层配置决定；
 * - 与 ExecutionAction.onFailure 配合使用。
 */
export interface FailurePolicy {
  /**
   * 失败时的处理方式：
   * - abort: 立即终止流程；
   * - continue: 忽略失败继续；
   * - rollback: 执行回滚动作。
   */
  strategy: "abort" | "continue" | "rollback";

  /**
   * 回滚动作（可选）：
   * - 仅在 strategy=rollback 时使用；
   * - 描述要调用的补偿操作。
   */
  rollbackAction?: ExecutionAction;
}
