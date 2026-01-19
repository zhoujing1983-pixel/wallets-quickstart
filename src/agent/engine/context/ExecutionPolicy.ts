/*
 * ExecutionPolicy：
 * - 仅用于执行层的策略提示；
 * - 不参与业务决策；
 * - 由 Planner 提供给 Engine 作为执行约束。
 */
export interface ExecutionPolicy {
  /**
   * 是否允许并行执行：
   * - true 表示可并行；
   * - false/undefined 表示顺序执行。
   */
  allowParallel?: boolean;

  /**
   * 超时（毫秒）：
   * - 单个动作或整体流程超时限制；
   * - 由 Engine 自行解释。
   */
  timeoutMs?: number;

  /**
   * 最大重试次数：
   * - 执行失败后的重试上限；
   * - 由 Engine 统一控制。
   */
  retry?: number;
}
