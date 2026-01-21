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
