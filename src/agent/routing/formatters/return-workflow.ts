/*
 * 文件作用：工作流结果格式化器：把内部结果结构转换为前端稳定响应结构。
 * 调用链阶段：路由与编排阶段（API 入站后）
 * 调用链关系：上游：src/agent/routing/route-service.ts::formatWorkflowResult()；下游：src/agent/routing/route-service.ts::routeAgentChat()（返回 formatReturnWorkflowResult() 结果）。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
type ReturnWorkflowResult = {
  case?: {
    decision?: string;
    missingFields?: unknown;
    nextSteps?: unknown;
    summary?: string;
  };
  replyText?: string;
};

const decisionLabelMap: Record<string, string> = {
  eligible: "符合退货条件",
  ineligible: "不符合退货条件",
  needs_info: "需要补充信息",
};

const fieldLabelMap: Record<string, string> = {
  orderId: "订单号",
  contact: "联系方式（邮箱或电话）",
  items: "退货商品名称及数量",
  purchaseDate: "购买日期",
  reason: "退货原因",
  condition: "商品状态/是否损坏（如有请提供照片）",
  preferredResolution: "期望处理方式（退款/换货/店铺积分）",
};

export const formatReturnWorkflowResult = (result: ReturnWorkflowResult) => {
  if (typeof result.replyText === "string" && result.replyText.trim()) {
    return {
      text: result.replyText.trim(),
      sources: [],
    };
  }
  const caseData = result.case ?? {};
  const decisionLabel = decisionLabelMap[caseData.decision ?? ""] ?? "需要补充信息";
  const missingFields = Array.isArray(caseData.missingFields)
    ? caseData.missingFields
    : [];
  const nextSteps = Array.isArray(caseData.nextSteps) ? caseData.nextSteps : [];
  const summary = typeof caseData.summary === "string" ? caseData.summary : "";

  const lines: string[] = [];
  if (decisionLabel === "需要补充信息") {
    lines.push("好的，我可以帮你处理退货。");
    if (missingFields.length > 0) {
      const mapped = missingFields
        .map((field) => fieldLabelMap[field])
        .filter(Boolean);
      if (mapped.length > 0) {
        lines.push(`为继续处理，请补充：${mapped.join("、")}。`);
      }
    }
  } else if (decisionLabel === "符合退货条件") {
    lines.push("好的，你的退货请求看起来符合条件。");
    if (summary) {
      lines.push(summary);
    }
    if (nextSteps.length > 0) {
      lines.push(nextSteps.join("；") + "。");
    }
  } else {
    lines.push("抱歉，你的退货请求可能不符合条件。");
    if (summary) {
      lines.push(summary);
    }
    if (nextSteps.length > 0) {
      lines.push(nextSteps.join("；") + "。");
    }
  }

  return {
    text: lines.join("\n"),
    sources: [],
  };
};