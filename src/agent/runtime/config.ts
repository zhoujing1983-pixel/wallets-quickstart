/*
 * 文件作用：运行框架配置解析：读取环境变量并决定当前启用的 agent 框架。
 * 调用链阶段：运行时决策阶段（框架选择与契约约束）
 * 调用链关系：上游：src/agent/runtime/factory.ts::framework 初始化；下游：src/agent/runtime/factory.ts::runtime 选择逻辑（消费 resolveAgentFramework()）。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
export type AgentFramework = "voltagent" | "langchain";

/**
 * 解析当前生效的 Agent 框架类型。
 * - 读取 AGENT_FRAMEWORK 环境变量；
 * - 仅接受 "langchain"，其余值全部回退到 "voltagent"；
 * - 这样可以保证默认路径稳定、避免配置错误导致启动失败。
 */
export const resolveAgentFramework = (): AgentFramework => {
  const raw = (process.env.AGENT_FRAMEWORK ?? "voltagent").trim().toLowerCase();
  if (raw === "langchain") {
    return "langchain";
  }
  return "voltagent";
};