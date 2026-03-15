/*
 * 文件作用：基于关键词/规则做轻量路由预判，为后续 workflow 选择提供快速入口。
 * 调用链阶段：路由与编排阶段（API 入站后）
 * 调用链关系：上游：src/agent/routing/route-service.ts::resolveWorkflowId()；下游：src/agent/routing/route-service.ts::executeWorkflow()（消费 matchKeywordRoute() 结果）。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import {
  FLIGHT_KEYWORDS,
  RETURN_KEYWORDS,
} from "@/agent/config/routing-config";

type RouteDecision = {
  workflowId: string;
  reason: string;
  source: "keyword";
};

const normalize = (value: string) => value.toLowerCase();

export const matchKeywordRoute = (input: string): RouteDecision | null => {
  const normalized = normalize(input);
  const flightMatched = FLIGHT_KEYWORDS.find((keyword) =>
    normalized.includes(normalize(keyword))
  );
  if (flightMatched) {
    return {
      workflowId: "flight-booking-workflow",
      reason: `keyword:${flightMatched}`,
      source: "keyword",
    };
  }
  const returnMatched = RETURN_KEYWORDS.find((keyword) =>
    normalized.includes(normalize(keyword))
  );
  if (returnMatched) {
    return {
      workflowId: "return-request-workflow",
      reason: `keyword:${returnMatched}`,
      source: "keyword",
    };
  }
  return null;
};