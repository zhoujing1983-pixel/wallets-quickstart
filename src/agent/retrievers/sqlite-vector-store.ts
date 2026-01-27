import path from "path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import type {
  VectorMatch,
  VectorRecord,
  VectorStore,
  VectorStoreUpsertOptions,
  VectorQuery,
} from "./vector-store";
import { distanceToScore } from "./vector-store";

/*
 * SQLite 向量存储实现（sqlite-vec）：
 * - 适用于本地/开发环境或小规模生产；
 * - 使用 vec0 虚拟表保存向量；
 * - 元数据表 rag_meta 用于存储索引信息（签名/维度）。
 */
export class SqliteVectorStore
  implements VectorStore<{ title: string; url?: string }>
{
  // 单例复用，避免重复打开 DB 文件。
  private static instance: Database.Database | null = null;
  // SQLite 文件路径（默认项目根目录）。
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath =
      dbPath ??
      (process.env.LOCAL_RAG_DB_PATH
        ? path.resolve(process.env.LOCAL_RAG_DB_PATH)
        : path.join(process.cwd(), "local-rag-vec.db"));
  }

  /*
   * 获取/初始化数据库连接：
   * - 加载 sqlite-vec 扩展；
   * - 创建元数据与文档表。
   */
  private getDb(): Database.Database {
    if (SqliteVectorStore.instance) {
      return SqliteVectorStore.instance;
    }
    const db = new Database(this.dbPath);
    loadSqliteVec(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS rag_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS rag_docs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        url TEXT
      );
    `);
    SqliteVectorStore.instance = db;
    return db;
  }

  async init(): Promise<void> {
    this.getDb();
  }

  async getMeta(key: string): Promise<string | null> {
    const db = this.getDb();
    const row = db
      .prepare("SELECT value FROM rag_meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    const db = this.getDb();
    db.prepare(
      "INSERT INTO rag_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, value);
  }

  /*
   * 确保向量表存在且维度一致：
   * - 维度变化时重建表；
   * - 避免混用不同维度向量。
   */
  private ensureVectorTable(dimension: number) {
    const db = this.getDb();
    const storedDim = db
      .prepare("SELECT value FROM rag_meta WHERE key = ?")
      .get("embedding_dim") as { value: string } | undefined;
    if (!storedDim || Number(storedDim.value) !== dimension) {
      db.exec("DROP TABLE IF EXISTS rag_vectors;");
      db.exec(
        `CREATE VIRTUAL TABLE rag_vectors USING vec0(embedding float[${dimension}])`
      );
      db.prepare(
        "INSERT INTO rag_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run("embedding_dim", String(dimension));
      return;
    }
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS rag_vectors USING vec0(embedding float[${dimension}])`
    );
  }

  async clear(): Promise<void> {
    const db = this.getDb();
    try {
      db.exec("DELETE FROM rag_vectors;");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/no such table: rag_vectors/i.test(error.message)
      ) {
        throw error;
      }
    }
    db.exec("DELETE FROM rag_docs;");
  }

  async upsert(
    records: VectorRecord<{ title: string; url?: string }>[],
    options?: VectorStoreUpsertOptions
  ): Promise<void> {
    const db = this.getDb();
    const dimension = options?.dimension;
    if (!dimension) {
      throw new Error("SQLite vector store requires dimension for upsert.");
    }
    this.ensureVectorTable(dimension);
    const insertDoc = db.prepare(
      "INSERT INTO rag_docs (id, title, content, url) VALUES (?, ?, ?, ?)"
    );
    const insertVector = db.prepare(
      "INSERT INTO rag_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)"
    );
    const insertMany = db.transaction(() => {
      for (const record of records) {
        if (record.embedding.length !== dimension) {
          throw new Error(
            `Embedding dimension mismatch: expected ${dimension}, got ${record.embedding.length}`
          );
        }
        const metadata = record.metadata ?? { title: "Untitled" };
        const result = insertDoc.run(
          record.id,
          metadata.title,
          record.text ?? "",
          metadata.url ?? null
        );
        const embedding = Float32Array.from(record.embedding);
        const embeddingBlob = Buffer.from(embedding.buffer);
        insertVector.run(
          Number(result.lastInsertRowid),
          embeddingBlob
        );
      }
    });
    insertMany();
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = this.getDb();
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT rowid FROM rag_docs WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ rowid: number }>;
    const rowIds = rows.map((row) => row.rowid);
    if (rowIds.length > 0) {
      const vecPlaceholders = rowIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM rag_vectors WHERE rowid IN (${vecPlaceholders})`).run(
        ...rowIds
      );
    }
    db.prepare(`DELETE FROM rag_docs WHERE id IN (${placeholders})`).run(...ids);
  }

  async query(query: VectorQuery): Promise<VectorMatch<{ title: string; url?: string }>[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        `
        SELECT
          rag_docs.id,
          rag_docs.title,
          rag_docs.content,
          rag_docs.url,
          rag_vectors.distance
        FROM rag_vectors
        JOIN rag_docs ON rag_docs.rowid = rag_vectors.rowid
        WHERE rag_vectors.embedding MATCH ? AND k = ?
        ORDER BY rag_vectors.distance
      `
      )
      .all(JSON.stringify(query.embedding), query.topK) as Array<{
      id: string;
      title: string;
      content: string;
      url?: string;
      distance: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      score: distanceToScore(row.distance),
      rawScore: row.distance,
      rawScoreType: "distance",
      text: row.content,
      metadata: {
        title: row.title,
        url: row.url,
      },
    }));
  }

  async close(): Promise<void> {
    if (!SqliteVectorStore.instance) return;
    SqliteVectorStore.instance.close();
    SqliteVectorStore.instance = null;
  }
}
