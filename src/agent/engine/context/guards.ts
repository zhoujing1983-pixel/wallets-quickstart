import { ExecutionContext } from "./ExecutionContext";

/*
 * 权限守卫：
 * - 只有核心 Agent（命名以 Agent 结尾）才能写入决策上下文；
 * - 避免非核心组件误写，破坏决策链。
 */
export function assertCanWriteDecision(
  ctx: ExecutionContext,
  agentName: string
) {
  if (!agentName.endsWith("Agent")) {
    throw new Error("Only Core Agents can write decision context");
  }
}
