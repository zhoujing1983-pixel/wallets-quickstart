/*
 * VectorStore 抽象接口：
 * - 统一 pg / sqlite / ES / Qdrant / Milvus 等向量后端的调用形态；
 * - score 统一语义：值越大越相关；
 * - options 预留后端特有参数（如 ES kNN / HNSW 参数）。
 */

export type VectorRecord<TMeta = Record<string, unknown>> = {
  // 记录唯一 ID（建议稳定且可追溯）。
  id: string;
  // 向量 embedding。
  embedding: number[];
  // 主要文本内容（可选）。
  text?: string;
  // 扩展字段（title/url 等）。
  metadata?: TMeta;
};

export type VectorQuery = {
  // 待检索的向量。
  embedding: number[];
  // 返回的最相近结果数量。
  topK: number;
  // 结构化过滤条件（由后端自行解析）。
  filter?: Record<string, unknown>;
  // 需要返回的字段控制（可减少传输）。
  include?: Array<"embedding" | "text" | "metadata" | "score">;
  // 预留后端自定义参数（ES/Milvus/Qdrant 等）。
  options?: Record<string, unknown>;
};

export type VectorMatch<TMeta = Record<string, unknown>> = {
  // 记录唯一 ID。
  id: string;
  // 统一后的 score：越大越相关。
  score: number;
  // 后端返回的原始分数（可选，便于调试）。
  rawScore?: number;
  // 原始分数类型（distance 表示越小越相似）。
  rawScoreType?: "distance" | "similarity";
  // 可选文本内容。
  text?: string;
  // 可选元数据。
  metadata?: TMeta;
};

export type VectorStoreStats = Record<string, unknown>;

export type VectorStoreInitOptions = {
  // 可选：显式传入向量维度，便于初始化索引结构。
  dimension?: number;
};

export type VectorStoreUpsertOptions = {
  // 当前批次的向量维度（用于初始化/校验）。
  dimension?: number;
};

export type VectorStoreQueryOptions = VectorQuery["options"];

export interface VectorStore<TMeta = Record<string, unknown>> {
  /*
   * 初始化资源（连接池 / 索引 / 元数据表）：
   * - 可在首次调用时惰性完成；
   * - 支持传入 dimension 提前建表。
   */
  init(options?: VectorStoreInitOptions): Promise<void>;

  /*
   * 批量写入或更新向量：
   * - 不同后端的 upsert 行为可能不同；
   * - 建议由上层控制是否全量重建。
   */
  upsert(
    records: VectorRecord<TMeta>[],
    options?: VectorStoreUpsertOptions
  ): Promise<void>;

  /*
   * 删除指定 ID 的向量记录：
   * - 适用于增量更新或数据下线。
   */
  delete(ids: string[]): Promise<void>;

  /*
   * 执行向量检索：
   * - 返回统一的 score；
   * - rawScore/rawScoreType 保留原始后端值。
   */
  query(query: VectorQuery): Promise<VectorMatch<TMeta>[]>;

  /*
   * 统计信息（可选）：
   * - 例如记录数、索引大小、后端版本等。
   */
  stats?(): Promise<VectorStoreStats>;

  /*
   * 释放资源（可选）：
   * - 连接池关闭；
   * - 文件句柄释放。
   */
  close?(): Promise<void>;

  /*
   * 清空索引（可选）：
   * - 用于全量重建时快速清理旧数据。
   */
  clear?(): Promise<void>;

  /*
   * 读取/写入索引级元数据（可选）：
   * - 用于保存签名、维度、版本等；
   * - 不影响 VectorStore 核心接口。
   */
  getMeta?(key: string): Promise<string | null>;
  setMeta?(key: string, value: string): Promise<void>;
}

/*
 * 距离转为 score（越大越相关）：
 * - 采用 1 / (1 + distance)，单调递减；
 * - 不依赖距离范围，兼容 L2 / cosine distance。
 */
export const distanceToScore = (distance: number) => {
  if (!Number.isFinite(distance)) {
    return 0;
  }
  return 1 / (1 + Math.max(0, distance));
};
