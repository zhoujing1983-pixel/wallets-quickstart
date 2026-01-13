import { ExecutionContext } from "./ExecutionContext";

export function assertCanWriteDecision(
  ctx: ExecutionContext,
  agentName: string
) {
  if (!agentName.endsWith("Agent")) {
    throw new Error("Only Core Agents can write decision context");
  }
}
