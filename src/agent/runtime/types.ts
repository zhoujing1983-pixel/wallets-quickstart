/*
 * 文件作用：运行时契约定义：声明 payload/response/stream 等跨框架统一类型。
 * 调用链阶段：运行时决策阶段（框架选择与契约约束）
 * 调用链关系：上游：src/agent/routing/route-service.ts::buildWorkflowInput()；下游：src/agent/runtime/*-provider.ts::executeWorkflow(...) 与 executor 层方法签名。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
/**
 * 聊天请求可选参数：
 * - 由前端或上层 API 透传；
 * - 用于控制 RAG、会话标识、思考开关等行为。
 */
export type ChatOptions = {
  needRag?: boolean;
  useLlmSummary?: boolean;
  ragRetriever?: "vector" | "pageindex";
  userId?: string;
  conversationId?: string;
  enableThinking?: boolean;
  streamAnswer?: boolean;
};

/**
 * 统一工作流执行载荷：
 * - input.query: 用户输入文本；
 * - input.options: 影响工作流执行策略；
 * - options: 便于下游服务做会话上下文透传。
 */
export type WorkflowPayload = {
  input: {
    query: string;
    options: {
      needRag: boolean;
      useLlmSummary?: boolean;
      ragRetriever?: "vector" | "pageindex";
      userId?: string;
      conversationId?: string;
      enableThinking?: boolean;
      streamAnswer?: boolean;
    };
  };
  options: {
    userId?: string;
    conversationId?: string;
  };
};

/**
 * 统一工作流响应结构：
 * - success/error 与现有后端约定保持一致；
 * - data.result 作为各工作流自定义返回体。
 */
export type WorkflowResponse = {
  success?: boolean;
  error?: string;
  data?: {
    result?: unknown;
  };
};

/**
 * Agent 运行时抽象接口：
 * - 不关心具体实现是 VoltAgent 还是 LangChain；
 * - 对上层仅暴露 executeWorkflow 一个统一入口。
 */
export type AgentWorkflowRuntime = {
  executeWorkflow: (
    workflowId: string,
    payload: WorkflowPayload
  ) => Promise<WorkflowResponse>;
  executeWorkflowStream?: (
    workflowId: string,
    payload: WorkflowPayload
  ) => Promise<Response>;
};