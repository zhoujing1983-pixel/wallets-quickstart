import { NextResponse } from "next/server";
import { resolveAgentFramework } from "@/agent/runtime/config";

/**
 * 根据 MODEL_PROVIDER 解析当前生效模型名。
 * - 仅用于前端展示当前配置；
 * - 不参与实际模型调用链。
 */
const resolveCurrentModel = () => {
  const provider = (process.env.MODEL_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "lmstudio") {
    return process.env.LM_STUDIO_MODEL ?? "";
  }
  if (provider === "qwen") {
    return process.env.QWEN_MODEL ?? "";
  }
  if (provider === "google") {
    return process.env.GOOGLE_MODEL ?? "";
  }
  return process.env.OLLAMA_MODEL ?? "";
};

/**
 * 解析支持 Think 开关的模型白名单。
 * - 环境变量格式：逗号分隔；
 * - 返回已 trim 且去空值的数组。
 */
const resolveThinkModels = () =>
  (process.env.AGENT_THINK_MODELS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * 返回当前 Agent 配置快照。
 * - 提供给前端初始化显示；
 * - 增加 agentFramework 字段用于确认框架切换是否生效。
 */
export async function GET() {
  const model = resolveCurrentModel();
  const provider = (process.env.MODEL_PROVIDER ?? "ollama").toLowerCase();
  const thinkModels = resolveThinkModels();
  const supportsThink = model.length > 0 && thinkModels.includes(model);
  const ragRetriever = (process.env.RAG_RETRIEVER ?? "vector").toLowerCase();
  const agentFramework = resolveAgentFramework();
  return NextResponse.json({
    success: true,
    data: { model, provider, supportsThink, ragRetriever, agentFramework },
  });
}
