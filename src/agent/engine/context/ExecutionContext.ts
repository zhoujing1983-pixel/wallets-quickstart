/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { CoreContext } from "./CoreContext";
import { DecisionContext } from "./DecisionContext";
import { ReasoningContext } from "./ReasoningContext";
import { ExecutionPhaseContext } from "./ExecutionPhaseContext";

/*
 * ExecutionContext：
 * - 全链路上下文汇总；
 * - 贯穿请求生命周期；
 * - 作为 guard/日志/记忆等组件的共享载体。
 */
export interface ExecutionContext {
  // 基础请求信息与用户元数据。
  core: CoreContext;
  // 业务决策上下文（由 Planner/Agent 写入）。
  decision: DecisionContext;
  // 推理/理解上下文（意图、实体等）。
  reasoning: ReasoningContext;
  // 执行阶段上下文（计划与结果）。
  execution: ExecutionPhaseContext;
}