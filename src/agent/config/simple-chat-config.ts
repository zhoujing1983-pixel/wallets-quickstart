/*
 * 文件作用：配置与规则定义：集中维护路由、简聊、工具策略等静态配置与判定规则。
 * 调用链阶段：配置解析阶段（请求进入前）
 * 调用链关系：上游：src/agent/routing/route-service.ts::resolveWorkflowId()；下游：src/agent/config/simple-chat-rule.ts::matchSimpleChatRule() 开关控制。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
export const SIMPLE_CHAT_RULE_ENABLED =
  (process.env.SIMPLE_CHAT_RULE_ENABLED ?? "true").toLowerCase() !== "false";