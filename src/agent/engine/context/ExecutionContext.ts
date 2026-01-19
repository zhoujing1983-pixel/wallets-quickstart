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
