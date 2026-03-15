/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
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