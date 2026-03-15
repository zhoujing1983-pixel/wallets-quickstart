/*
 * 文件作用：数据库连接层：创建并管理数据库客户端连接与基础配置。
 * 调用链阶段：持久化阶段（数据访问与连接管理）
 * 调用链关系：上游：src/agent/dao/workflow-dao.ts::ensureTable()/CRUD、src/agent/retrievers/pg-vector-store.ts；下游：pg.Pool 连接与查询执行。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { Pool } from "pg";

let pool: Pool | null = null;

export const getPgPool = () => {
  if (pool) return pool;
  const connectionString =
    process.env.PGVECTOR_URL ?? process.env.DATABASE_URL ?? "";
  if (!connectionString) {
    throw new Error("Missing PGVECTOR_URL or DATABASE_URL.");
  }
  pool = new Pool({ connectionString });
  return pool;
};