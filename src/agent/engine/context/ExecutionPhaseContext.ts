/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { ExecutionPlan } from "./ExecutionPlan";

/*
 * ExecutionPhaseContext：
 * - 记录执行阶段的数据；
 * - 包含计划、执行结果与扩展字段；
 * - 写入 ExecutionContext.execution。
 */
export interface ExecutionPhaseContext {
  // 当前执行计划（来自 Planner）。
  plan?: ExecutionPlan;
  // 执行结果（由 Engine 写入）。
  result?: ExecutionResult;
  // 扩展字段，用于挂载执行期临时数据。
  extensions?: Record<string, any>;
}

/*
 * ExecutionResult：
 * - 汇总执行状态；
 * - 输出可供上层消费；
 * - error 用于错误回传与日志。
 */
export interface ExecutionResult {
  // 执行状态：成功/失败/部分成功。
  status: "success" | "failed" | "partial";
  // 业务输出（结构不固定）。
  output?: any;
  // 错误信息（可选）。
  error?: {
    code?: string;
    message: string;
  };
}