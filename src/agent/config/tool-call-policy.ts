/*
 * 工具调用策略配置：
 * - 统一控制 Agent 是否允许“自行”调用工具；
 * - 通过上下文 ragMode 判断是否允许工具调用，覆盖静态工具的默认启用行为。
 *
 * 策略值说明（AGENT_TOOL_CALL_POLICY）：
 * - "auto"：默认行为，允许工具调用（保持原逻辑）；
 * - "off"：全局禁用工具调用，任何流程都不允许模型发起工具调用；
 * - "rag-only"：仅在 ragMode=rag 时允许工具调用，ragMode=llm 时禁止。
 *
 * 这样做的目的：
 * - 前端打开“LLM 开关”时，可以彻底避免模型“顺手”调用本地 RAG 工具；
 * - 同时保留 ragMode=rag 的工具能力，避免破坏原本的检索体验。
 */
const toolCallPolicy = (process.env.AGENT_TOOL_CALL_POLICY ?? "auto").toLowerCase();

type RagMode = "rag" | "llm";

const TOOL_CALL_RAG_MODE_KEY = "toolCallRagMode";

const resolveRagMode = (
  context?: Map<string | symbol, unknown>
): RagMode => {
  const raw = context?.get(TOOL_CALL_RAG_MODE_KEY);
  return raw === "llm" ? "llm" : "rag";
};

const shouldAllowTools = (ragMode: RagMode) => {
  if (toolCallPolicy === "off") {
    return false;
  }
  if (toolCallPolicy === "rag-only" && ragMode === "llm") {
    return false;
  }
  return true;
};

export const buildToolCallContext = (ragMode: RagMode) => ({
  [TOOL_CALL_RAG_MODE_KEY]: ragMode,
});

export const resolveToolCallTools = <T>(
  context: Map<string | symbol, unknown> | undefined,
  tools: T[]
) => {
  // 默认没有上下文时保持原行为，避免影响其他调用路径。
  if (!context) {
    return tools;
  }
  const ragMode = resolveRagMode(context);
  if (!shouldAllowTools(ragMode)) {
    if (tools.length > 0) {
      const yellow = "\u001b[33m";
      const reset = "\u001b[0m";
      console.log(
        `${yellow}[tool-policy] 工具已被策略禁用${reset}`,
        JSON.stringify({ ragMode, policy: toolCallPolicy })
      );
    }
    return [];
  }
  return tools;
};
