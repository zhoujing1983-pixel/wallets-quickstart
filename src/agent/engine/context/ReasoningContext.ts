/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::create*Workflow()；下游：src/agent/engine/context/createContext.ts::createInitialContext() 与 guards.ts::assert*()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
/*
 * ReasoningContext：
 * - 记录理解/推理阶段的中间信息；
 * - 便于后续调试、回溯与分析；
 * - 不直接影响执行决策。
 */
export interface ReasoningContext {
  // 解析出的意图。
  intent?: string;
  // 置信度评分（0-1 或内部约定）。
  confidence?: number;
  // 识别出的实体/槽位信息。
  entities?: Record<string, any>;
  // 备注/自由文本（可记录解释或提示）。
  notes?: string;
  // 信息来源列表（RAG/工具/记忆）。
  sources?: Array<{
    type: "rag" | "tool" | "memory";
    name?: string;
  }>;
}