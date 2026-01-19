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
