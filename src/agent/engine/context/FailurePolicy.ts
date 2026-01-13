import { ExecutionAction } from "./ExecutionAction.js";
export interface FailurePolicy {
  /**
   * 失败时的处理方式
   */
  strategy: "abort" | "continue" | "rollback";

  /**
   * 回滚动作（可选）
   */
  rollbackAction?: ExecutionAction;
}
