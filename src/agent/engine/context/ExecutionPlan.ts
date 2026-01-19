import { ExecutionAction } from "./ExecutionAction.js";
import { ExecutionPolicy } from "./ExecutionPolicy.js";
/**
 * ExecutionPlan
 * -----------------
 * Planner Agent 的唯一输出：
 * - 描述「Engine 接下来要做什么」；
 * - 不包含推理过程或业务理由；
 * - Engine 按此计划执行并回写结果。
 */
export interface ExecutionPlan {
  /**
   * 执行步骤列表（按顺序）：
   * - 每一步对应一个 ExecutionAction；
   * - 默认按数组顺序串行执行。
   */
  actions: ExecutionAction[];

  /**
   * 是否需要人工审批：
   * - 由 Planner 决定；
   * - Engine 执行状态机处理。
   */
  requiresHuman?: boolean;

  /**
   * 可选：执行策略提示（不参与业务决策）：
   * - 例如超时、并行、重试等；
   * - Engine 可选择性遵循。
   */
  executionPolicy?: ExecutionPolicy;
}
