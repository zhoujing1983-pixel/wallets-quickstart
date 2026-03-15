/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
/*
 * DecisionContext：
 * - 记录模型/Planner 做出的业务决策；
 * - 不直接用于执行，只用于后续路由或审计。
 */
export interface DecisionContext {
  // QA 场景的决策信息。
  qa?: QaDecision;
  // 路由/审批等决策信息。
  routing?: RoutingDecision;
}

/*
 * QA 决策：
 * - 判断是否为简单问题；
 * - 可选附带置信度。
 */
export interface QaDecision {
  // 是否为简单问题（可直接回答）。
  isSimple: boolean;
  // 置信度分数（0-1 或内部约定）。
  confidence?: number;
}

/*
 * Routing 决策：
 * - 判断是否需要业务动作或人工介入；
 * - 给出路由类型与风险等级。
 */
export interface RoutingDecision {
  // 是否需要执行真实业务动作。
  needBusinessAction: boolean;
  // 是否必须人工审批。
  needHumanApproval: boolean;
  // 路由类型（自定义枚举）。
  routeType?: string;
  // 风险等级，用于审批或风控。
  riskLevel?: "low" | "medium" | "high";
}