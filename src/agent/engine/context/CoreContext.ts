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
