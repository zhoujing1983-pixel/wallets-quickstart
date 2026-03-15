/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
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