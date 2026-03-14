import "dotenv/config";

// 启动入口根据 AGENT_FRAMEWORK 分流：voltagent 或 langchain。
const framework = (process.env.AGENT_FRAMEWORK ?? "voltagent").trim().toLowerCase();

if (framework === "langchain") {
  // LangChain 模式：启动独立 workflow server（默认 3142）。
  console.log("[agent-runtime] AGENT_FRAMEWORK=langchain, starting LangChain server.");
  void import("./langchain-server");
} else {
  // VoltAgent 模式：保持原有 server 启动路径（默认 3141）。
  console.log("[agent-runtime] AGENT_FRAMEWORK=voltagent, starting VoltAgent server.");
  void import("./voltagentopenai");
}
