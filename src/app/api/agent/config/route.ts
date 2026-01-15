import { NextResponse } from "next/server";

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

const resolveThinkModels = () =>
  (process.env.AGENT_THINK_MODELS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export async function GET() {
  const model = resolveCurrentModel();
  const provider = (process.env.MODEL_PROVIDER ?? "ollama").toLowerCase();
  const thinkModels = resolveThinkModels();
  const supportsThink = model.length > 0 && thinkModels.includes(model);
  return NextResponse.json({
    success: true,
    data: { model, provider, supportsThink },
  });
}
