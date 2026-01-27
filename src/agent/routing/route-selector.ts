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
