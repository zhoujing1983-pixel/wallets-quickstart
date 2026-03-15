/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
/*
 * CoreContext：
 * - 每次请求的基础上下文；
 * - 不包含业务决策，只承载追踪与用户元信息；
 * - 作为 ExecutionContext.core 的根节点。
 */
export interface CoreContext {
  // 请求唯一标识，用于日志/排查。
  requestId: string;
  // 可选的链路追踪 ID（例如 APM / gateway）。
  traceId?: string;
  // 创建时间戳（毫秒）。
  createdAt: number;

  // 触发请求的用户信息。
  user: {
    // 用户唯一 ID。
    id: string;
    // 角色（如 admin / customer）。
    role?: string;
    // 语言/地区偏好（如 zh-CN）。
    locale?: string;
  };

  // 来源通道，区分聊天、API 或 workflow。
  channel: "chat" | "api" | "workflow";
  // 多租户场景下的 tenant ID。
  tenantId?: string;
}