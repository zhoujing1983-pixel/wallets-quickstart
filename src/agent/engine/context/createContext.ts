import { ExecutionContext } from "./ExecutionContext";

/*
 * 初始化执行上下文：
 * - 自动生成 requestId；
 * - 写入用户与通道信息；
 * - 初始化决策/推理/执行子上下文为空对象。
 */
export function createInitialContext(
  userId: string,
  channel: "chat" | "api" | "workflow"
): ExecutionContext {
  return {
    core: {
      requestId: crypto.randomUUID(),
      createdAt: Date.now(),
      user: { id: userId },
      channel,
    },
    decision: {},
    reasoning: {},
    execution: {},
  };
}
