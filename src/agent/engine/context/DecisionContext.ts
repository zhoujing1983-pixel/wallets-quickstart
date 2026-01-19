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
