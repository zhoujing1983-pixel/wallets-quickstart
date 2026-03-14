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
