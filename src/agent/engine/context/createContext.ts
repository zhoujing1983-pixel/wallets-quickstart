import { ExecutionContext } from "./ExecutionContext";

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
