export interface DecisionContext {
  qa?: QaDecision;
  routing?: RoutingDecision;
}

export interface QaDecision {
  isSimple: boolean;
  confidence?: number;
}

export interface RoutingDecision {
  needBusinessAction: boolean;
  needHumanApproval: boolean;
  routeType?: string;
  riskLevel?: "low" | "medium" | "high";
}
