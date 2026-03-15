/*
 * 文件作用：配置与规则定义：集中维护路由、简聊、工具策略等静态配置与判定规则。
 * 调用链阶段：配置解析阶段（请求进入前）
 * 调用链关系：上游：src/agent/routing/route-selector.ts::matchKeywordRoute()、src/agent/runtime/langchain-executor.ts::executeRoutingWorkflow()；下游：workflowId 选择逻辑。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
export const RETURN_KEYWORDS = [
  "return",
  "refund",
  "exchange",
  "cancel",
  "cancellation",
  "return policy",
  "refund policy",
  "return request",
  "退货",
  "退款",
  "换货",
  "退货流程",
  "退货政策",
  "取消订单",
];

export const FLIGHT_KEYWORDS = [
  "flight",
  "flights",
  "air ticket",
  "airfare",
  "book flight",
  "flight booking",
  "airline ticket",
  "机票",
  "订票",
  "航班",
  "飞机票",
  "查航班",
  "订机票",
  "机票预订",
  "多程",
  "多城市",
];

export const ROUTING_WORKFLOWS = [
  "flight-booking-workflow",
  "return-request-workflow",
  "direct-chat-workflow",
  "local-rag-workflow",
] as const;