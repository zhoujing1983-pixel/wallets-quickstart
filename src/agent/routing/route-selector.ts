import { RETURN_KEYWORDS } from "@/agent/routing/routing-config";

type RouteDecision = {
  workflowId: string;
  reason: string;
  source: "keyword";
};

const normalize = (value: string) => value.toLowerCase();

export const matchKeywordRoute = (input: string): RouteDecision | null => {
  const normalized = normalize(input);
  const matched = RETURN_KEYWORDS.find((keyword) =>
    normalized.includes(normalize(keyword))
  );
  if (!matched) {
    return null;
  }
  return {
    workflowId: "return-request-workflow",
    reason: `keyword:${matched}`,
    source: "keyword",
  };
};
