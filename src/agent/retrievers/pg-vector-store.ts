import { Pool } from "pg";
import { getPgPool } from "@/agent/db/pg";
import type {
  VectorMatch,
  VectorRecord,
  VectorStore,
  VectorStoreUpsertOptions,
  VectorQuery,
} from "./vector-store";
import { distanceToScore } from "./vector-store";

/*
 * Postgres + pgvector 向量存储实现：
 * - 适合生产环境与多并发场景；
 * - 使用 vector 扩展与 <=> (cosine distance) 做相似度检索；
 * - 通过元数据表保存维度与签名。
 */
export class PgVectorStore
  implements VectorStore<{ title: string; url?: string }>
{
  // 连接池实例（延迟创建）。
  private pool: Pool | null = null;
  // Postgres 连接字符串（仅自定义连接时使用）。
  private readonly connectionString: string | null;

  constructor(connectionString?: string) {
    const trimmed = connectionString?.trim();
    if (trimmed) {
      this.connectionString = trimmed;
      return;
    }
    const envUrl =
      process.env.PGVECTOR_URL ?? process.env.DATABASE_URL ?? "";
    if (!envUrl) {
      throw new Error("Missing PGVECTOR_URL or DATABASE_URL for PgVectorStore.");
    }
    this.connectionString = null;
  }

  /*
   * 懒加载连接池：
   * - 避免在未使用 PG 时建立连接；
   * - 统一在 init/query/upsert 时复用。
   */
  private getPool(): Pool {
    if (this.connectionString) {
      if (!this.pool) {
        this.pool = new Pool({ connectionString: this.connectionString });
      }
      return this.pool;
    }
    return getPgPool();
  }

  /*
   * 将 embedding 数组转换为 pgvector 接受的字符串格式：
   * - 形如 "[0.1,0.2,0.3]"；
   * - 通过参数化查询传入并 cast 为 vector。
   */
  private vectorToSql(embedding: number[]) {
    return `[${embedding.join(",")}]`;
  }

  async init(): Promise<void> {
    const pool = this.getPool();
    // 安装 pgvector 扩展（需要数据库允许 CREATE EXTENSION）。
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    // 元数据表：存放签名、维度等。
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rag_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // 文档表：保存可读文本与来源信息。
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rag_docs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        url TEXT
      );
    `);
  }

  async getMeta(key: string): Promise<string | null> {
    const pool = this.getPool();
    const result = await pool.query(
      "SELECT value FROM rag_meta WHERE key = $1",
      [key]
    );
    return result.rows[0]?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    const pool = this.getPool();
    await pool.query(
      `
      INSERT INTO rag_meta (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `,
      [key, value]
    );
  }

  /*
   * 确保向量表维度一致：
   * - 维度变更时重建向量表；
   * - 避免不同维度混用导致查询异常。
   */
  private async ensureVectorTable(dimension: number) {
    const pool = this.getPool();
    const storedDim = await this.getMeta("embedding_dim");
    if (!storedDim || Number(storedDim) !== dimension) {
      await pool.query("DROP TABLE IF EXISTS rag_vectors;");
      await pool.query(`
        CREATE TABLE rag_vectors (
          id TEXT PRIMARY KEY REFERENCES rag_docs(id) ON DELETE CASCADE,
          embedding vector(${dimension})
        );
      `);
      await this.setMeta("embedding_dim", String(dimension));
      return;
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rag_vectors (
        id TEXT PRIMARY KEY REFERENCES rag_docs(id) ON DELETE CASCADE,
        embedding vector(${dimension})
      );
    `);
  }

  async clear(): Promise<void> {
    const pool = this.getPool();
    await pool.query("DELETE FROM rag_vectors;");
    await pool.query("DELETE FROM rag_docs;");
  }

  async upsert(
    records: VectorRecord<{ title: string; url?: string }>[],
    options?: VectorStoreUpsertOptions
  ): Promise<void> {
    const dimension = options?.dimension;
    if (!dimension) {
      throw new Error("PgVectorStore requires dimension for upsert.");
    }
    const pool = this.getPool();
    await this.ensureVectorTable(dimension);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        const metadata = record.metadata ?? { title: "Untitled" };
        await client.query(
          `
          INSERT INTO rag_docs (id, title, content, url)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id)
          DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, url = EXCLUDED.url
        `,
          [record.id, metadata.title, record.text ?? "", metadata.url ?? null]
        );
        await client.query(
          `
          INSERT INTO rag_vectors (id, embedding)
          VALUES ($1, $2::vector)
          ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding
        `,
          [record.id, this.vectorToSql(record.embedding)]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const pool = this.getPool();
    await pool.query("DELETE FROM rag_docs WHERE id = ANY($1)", [ids]);
  }

  async query(
    query: VectorQuery
  ): Promise<VectorMatch<{ title: string; url?: string }>[]> {
    const pool = this.getPool();
    // cosine distance：越小越相似
    const result = await pool.query(
      `
      SELECT
        rag_docs.id,
        rag_docs.title,
        rag_docs.content,
        rag_docs.url,
        (rag_vectors.embedding <=> $1::vector) AS distance
      FROM rag_vectors
      JOIN rag_docs ON rag_docs.id = rag_vectors.id
      ORDER BY distance ASC
      LIMIT $2
    `,
      [this.vectorToSql(query.embedding), query.topK]
    );
    return result.rows.map((row) => ({
      id: row.id,
      score: distanceToScore(Number(row.distance)),
      rawScore: Number(row.distance),
      rawScoreType: "distance",
      text: row.content,
      metadata: {
        title: row.title,
        url: row.url ?? undefined,
      },
    }));
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }
}
