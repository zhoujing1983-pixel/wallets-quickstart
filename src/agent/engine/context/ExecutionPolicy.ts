export interface ExecutionPolicy {
  /**
   * 是否允许并行执行
   */
  allowParallel?: boolean;

  /**
   * 超时（毫秒）
   */
  timeoutMs?: number;

  /**
   * 最大重试次数
   */
  retry?: number;
}
