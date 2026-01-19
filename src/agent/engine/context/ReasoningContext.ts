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
