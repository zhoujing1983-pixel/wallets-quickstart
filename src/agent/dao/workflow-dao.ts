import type { Pool } from "pg";
import { getPgPool } from "@/agent/db/pg";

export type WorkflowRecord = {
  id: string;
  name: string;
  definition: unknown;
  updatedAt: string;
};

let tableReady = false;

const ensureTable = async (pgPool: Pool) => {
  if (tableReady) return;
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS agent_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  tableReady = true;
};

export const workflowDao = {
  async upsert(id: string, name: string, definition: unknown) {
    const pgPool = getPgPool();
    await ensureTable(pgPool);
    await pgPool.query(
      `
      INSERT INTO agent_workflows (id, name, definition, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW(), NOW())
      ON CONFLICT (id)
      DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = NOW()
    `,
      [id, name, JSON.stringify(definition)]
    );
  },

  async getById(id: string): Promise<WorkflowRecord | null> {
    const pgPool = getPgPool();
    await ensureTable(pgPool);
    const result = await pgPool.query(
      `
      SELECT id, name, definition, updated_at
      FROM agent_workflows
      WHERE id = $1
    `,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      definition: row.definition,
      updatedAt: row.updated_at,
    };
  },

  async list(limit = 30): Promise<WorkflowRecord[]> {
    const pgPool = getPgPool();
    await ensureTable(pgPool);
    const result = await pgPool.query(
      `
      SELECT id, name, definition, updated_at
      FROM agent_workflows
      ORDER BY updated_at DESC
      LIMIT $1
    `,
      [limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      definition: row.definition,
      updatedAt: row.updated_at,
    }));
  },
};
