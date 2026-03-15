/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::执行上下文初始化；下游：src/agent/engine/context/guards.ts::assert*() 与 context 接口类型。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
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