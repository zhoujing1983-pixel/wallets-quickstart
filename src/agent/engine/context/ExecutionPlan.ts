import { ExecutionAction } from "./ExecutionAction.js";
import { ExecutionPolicy } from "./ExecutionPolicy.js";
/**
 * ExecutionPlan
 * -----------------
 * Return Planner Agent 的唯一输出
 * 描述「Engine 接下来要做什么」，而不是「为什么要做」
 */
export interface ExecutionPlan {
  /**
   * 执行步骤列表（按顺序）
   */
  actions: ExecutionAction[];

  /**
   * 是否需要人工审批
   * - 由 Planner 决定
   * - 由 Engine 执行状态机处理
   */
  requiresHuman?: boolean;

  /**
   * 可选：执行策略提示（不参与业务决策）
   */
  executionPolicy?: ExecutionPolicy;
}
