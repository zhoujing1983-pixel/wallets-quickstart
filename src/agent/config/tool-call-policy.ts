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
// 从环境变量读取工具调用策略，统一规范成小写便于判断。
const toolCallPolicy = (
  process.env.AGENT_TOOL_CALL_POLICY ?? "auto"
).toLowerCase();

type RagMode = "rag" | "llm";

// 上下文里存放 ragMode 的键名，避免与业务字段冲突。
const TOOL_CALL_RAG_MODE_KEY = "toolCallRagMode";
const TOOL_CALL_DISABLED_KEY = "toolCallDisabled";

/*
 * 从上下文推断 ragMode：
 * - 不存在时默认 rag；
 * - 仅当显式写入 "llm" 时走 llm。
 */
const resolveRagMode = (
  context?: Map<string | symbol, unknown>
): RagMode => {
  const raw = context?.get(TOOL_CALL_RAG_MODE_KEY);
  return raw === "llm" ? "llm" : "rag";
};

/*
 * 基于策略判断是否允许工具调用：
 * - off：全局禁用；
 * - rag-only：ragMode=llm 时禁用；
 * - auto：保持默认行为。
 */
const shouldAllowTools = (ragMode: RagMode) => {
  if (toolCallPolicy === "off") {
    return false;
  }
  if (toolCallPolicy === "rag-only" && ragMode === "llm") {
    return false;
  }
  return true;
};

// 生成注入上下文的对象，方便上层传入到 Agent 调用。
export const buildToolCallContext = (ragMode: RagMode) => ({
  [TOOL_CALL_RAG_MODE_KEY]: ragMode,
});

export const buildToolCallContextWithDisabled = (ragMode: RagMode) => ({
  [TOOL_CALL_RAG_MODE_KEY]: ragMode,
  [TOOL_CALL_DISABLED_KEY]: true,
});

/*
 * 根据 ragMode 过滤工具列表：
 * - 没有上下文时保持原工具列表；
 * - 策略命中时直接返回空数组，阻断模型调用。
 */
export const resolveToolCallTools = <T>(
  context: Map<string | symbol, unknown> | undefined,
  tools: T[]
) => {
  // 默认没有上下文时保持原行为，避免影响其他调用路径。
  if (!context) {
    return tools;
  }
  if (context.get(TOOL_CALL_DISABLED_KEY) === true) {
    if (tools.length > 0) {
      const yellow = "\u001b[33m";
      const reset = "\u001b[0m";
      console.log(
        `${yellow}[tool-policy] 工具已被上下文禁用${reset}`,
        JSON.stringify({ policy: "context-disabled" })
      );
    }
    return [];
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
