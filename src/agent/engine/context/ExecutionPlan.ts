/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
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