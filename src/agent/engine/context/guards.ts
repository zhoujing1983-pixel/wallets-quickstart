/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::上下文状态检查；下游：抛错/校验后回到 workflow 执行主流程。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
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