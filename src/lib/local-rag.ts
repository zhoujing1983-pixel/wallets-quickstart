import path from "path";
import fs from "node:fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { encode, decode } from "gpt-tokenizer";
import { parseExcel } from "@/lib/ingest/parse-excel";
import { parseWord } from "@/lib/ingest/parse-word";
import { parsePdf } from "@/lib/ingest/parse-pdf";

// Ingested document (pre-chunk).
type RagDoc = {
  title: string;
  content: string;
  url?: string;
};

// Vector search result (post-chunk).
type RagMatch = {
  id: number;
  title: string;
  content: string;
  url?: string;
  distance: number;
};

// Defaults are production-friendly and can be overridden via .env.
const DEFAULT_INGEST_DIR = path.join(process.cwd(), "rag-docs");
const DEFAULT_EMBEDDING_MODEL = "text-embedding-v3";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_DB_PATH = path.join(process.cwd(), "local-rag-vec.db");
const DEFAULT_CHUNK_TOKENS = 400;
const DEFAULT_CHUNK_OVERLAP = 60;
const DEFAULT_TOP_K = 4;
const DEFAULT_MAX_FILE_BYTES = 200_000;
const DEFAULT_EMBEDDING_BATCH = 10;
const DEFAULT_EXTENSIONS = [
  ".md",
  ".mdx",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
];
const DEFAULT_EXCLUDES = [
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "public",
];

// Shorten long content for readable snippets in the response.
const clip = (text: string, max = 240) => {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
};

// Strip leading markdown headings and normalize whitespace for final answer.
const normalizeAnswer = (text: string) =>
  text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

// Normalize text for stable chunking/embedding.
const cleanText = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Split markdown into semantic sections using headings and blank lines.
const splitMarkdown = (text: string) => {
  const lines = text.split(/\r?\n/);
  const sections: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const chunk = buffer.join("\n").trim();
    if (chunk) sections.push(chunk);
    buffer = [];
  };
  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line.trim());
    const isBlank = line.trim().length === 0;
    if (isHeading && buffer.length > 0) {
      flush();
    }
    if (isBlank) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
};

// Token-based chunking using GPT-style BPE tokens.
const chunkByTokens = (text: string, chunkSize: number, overlap: number) => {
  const clean = cleanText(text);
  if (!clean) return [];
  const tokens = encode(clean);
  if (tokens.length === 0) return [];
  const step = Math.max(1, chunkSize - overlap);
  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i += step) {
    const slice = tokens.slice(i, i + chunkSize);
    const chunk = decode(slice).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
};

// Recursively enumerate files under the ingest directory.
const listFiles = (
  dir: string,
  extensions: string[],
  excludes: Set<string>,
  acc: string[] = []
) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (excludes.has(entry.name)) continue;
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(nextPath, extensions, excludes, acc);
      continue;
    }
    if (extensions.includes(path.extname(entry.name).toLowerCase())) {
      acc.push(nextPath);
    }
  }
  return acc;
};

const parseFile = async (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  if (extension === ".pdf") {
    return parsePdf(buffer);
  }
  if (extension === ".docx") {
    return parseWord(buffer);
  }
  if (extension === ".xls" || extension === ".xlsx") {
    return parseExcel(buffer);
  }
  const content = fs.readFileSync(filePath, "utf8");
  return { content };
};

// Signature for change detection (size + mtime per file).
const computeSignature = (files: string[]) => {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const stat = fs.statSync(file);
    hash.update(file);
    hash.update(String(stat.size));
    hash.update(String(stat.mtimeMs));
  }
  return hash.digest("hex");
};

// Load ingest docs from disk (no fallback).
const loadIngestDocs = async () => {
  const ingestDir = process.env.RAG_INGEST_DIR
    ? path.resolve(process.env.RAG_INGEST_DIR)
    : DEFAULT_INGEST_DIR;
  if (!fs.existsSync(ingestDir)) {
    return { docs: [], signature: "empty" };
  }
  const extensions =
    process.env.RAG_INGEST_EXTENSIONS?.split(",").map((ext) => ext.trim()) ??
    DEFAULT_EXTENSIONS;
  const excludes = new Set(
    process.env.RAG_INGEST_EXCLUDE?.split(",").map((entry) => entry.trim()) ??
      DEFAULT_EXCLUDES
  );
  const files = listFiles(ingestDir, extensions, excludes);
  if (files.length === 0) {
    return { docs: [], signature: "empty" };
  }
  const maxBytes = Number(process.env.RAG_MAX_FILE_BYTES ?? DEFAULT_MAX_FILE_BYTES);
  const docs: RagDoc[] = [];
  for (const file of files) {
    const stat = fs.statSync(file);
    if (stat.size > maxBytes) continue;
    const relative = path.relative(process.cwd(), file);
    try {
      const parsed = await parseFile(file);
      if (!parsed.content.trim()) continue;
      docs.push({
        title: path.basename(file),
        content: parsed.content,
        url: relative,
      });
    } catch {
      // Skip files that fail parsing.
    }
  }
  return { docs, signature: computeSignature(files) };
};

// Resolve embedding config from env (Qwen OpenAI-compatible endpoint).
const getEmbeddingConfig = () => {
  const apiKey =
    process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? "";
  const baseURL = process.env.QWEN_BASE_URL ?? DEFAULT_BASE_URL;
  const model =
    process.env.RAG_EMBEDDING_MODEL ??
    process.env.QWEN_EMBEDDING_MODEL ??
    DEFAULT_EMBEDDING_MODEL;
  return { apiKey, baseURL, model };
};

// Call embeddings endpoint in batches.
const embedTexts = async (texts: string[]) => {
  const { apiKey, baseURL, model } = getEmbeddingConfig();
  if (!apiKey) {
    throw new Error("Missing QWEN_API_KEY or DASHSCOPE_API_KEY for embeddings.");
  }
  const res = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Embedding request failed: ${res.status} ${detail}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
  };
  if (!data?.data || data.data.length === 0) {
    throw new Error("Embedding request returned no data.");
  }
  return data.data.map((item) => item.embedding);
};

let dbInstance: Database.Database | null = null;
let indexPromise: Promise<void> | null = null;

// Open SQLite and initialize metadata + docs tables.
const getDb = () => {
  if (dbInstance) return dbInstance;
  const dbPath = process.env.LOCAL_RAG_DB_PATH
    ? path.resolve(process.env.LOCAL_RAG_DB_PATH)
    : DEFAULT_DB_PATH;
  const db = new Database(dbPath);
  loadSqliteVec(db);
  // Metadata for ingest signature and embedding dimension.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Store chunk text separately from vectors to keep vec0 lean.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      url TEXT
    );
  `);
  dbInstance = db;
  return db;
};

// Read a single metadata entry.
const getMeta = (db: Database.Database, key: string) => {
  const row = db.prepare("SELECT value FROM rag_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
};

// Upsert a metadata entry.
const setMeta = (db: Database.Database, key: string, value: string) => {
  db.prepare(
    "INSERT INTO rag_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
};

// Ensure vec0 table matches current embedding dimension.
const ensureVectorTable = (db: Database.Database, dimension: number) => {
  const storedDim = getMeta(db, "embedding_dim");
  if (!storedDim || Number(storedDim) !== dimension) {
    db.exec("DROP TABLE IF EXISTS rag_vectors;");
    db.exec(
      `CREATE VIRTUAL TABLE rag_vectors USING vec0(embedding float[${dimension}])`
    );
    setMeta(db, "embedding_dim", String(dimension));
  } else {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS rag_vectors USING vec0(embedding float[${dimension}])`
    );
  }
};

// Build or refresh the vector index if source docs changed.
const indexDocuments = async () => {
  const db = getDb();
  const { docs, signature } = await loadIngestDocs();
  const currentSignature = getMeta(db, "ingest_signature");
  const force =
    (process.env.RAG_FORCE_REINDEX ?? "").toLowerCase() === "true";
  if (!force && currentSignature === signature) {
    return;
  }
  const chunkSize = Number(process.env.RAG_CHUNK_TOKENS ?? DEFAULT_CHUNK_TOKENS);
  const overlap = Number(process.env.RAG_CHUNK_OVERLAP ?? DEFAULT_CHUNK_OVERLAP);
  // Chunk all docs before embedding.
  const chunks: RagDoc[] = [];
  for (const doc of docs) {
    const sections = splitMarkdown(doc.content);
    const slices: string[] = [];
    for (const section of sections) {
      slices.push(...chunkByTokens(section, chunkSize, overlap));
    }
    if (slices.length === 0) continue;
    for (let i = 0; i < slices.length; i += 1) {
      chunks.push({
        title: slices.length > 1 ? `${doc.title} (chunk ${i + 1})` : doc.title,
        content: slices[i],
        url: doc.url,
      });
    }
  }
  if (chunks.length === 0) {
    setMeta(db, "ingest_signature", signature);
    setMeta(db, "ingest_count", "0");
    return;
  }
  // Embed in batches to keep API calls small.
  const batchSize = Number(
    process.env.RAG_EMBEDDING_BATCH ?? DEFAULT_EMBEDDING_BATCH
  );
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const slice = chunks.slice(i, i + batchSize);
    const vectors = await embedTexts(
      slice.map((item) => `${item.title}\n\n${item.content}`)
    );
    embeddings.push(...vectors);
  }
  const dimension = embeddings[0]?.length ?? 0;
  if (!dimension) {
    throw new Error("Embedding dimension missing from response.");
  }
  ensureVectorTable(db, dimension);
  // Full rebuild keeps rowid alignment consistent with rag_docs.
  db.exec("DELETE FROM rag_vectors;");
  db.exec("DELETE FROM rag_docs;");
  const insertDoc = db.prepare(
    "INSERT INTO rag_docs (title, content, url) VALUES (?, ?, ?)"
  );
  const insertVector = db.prepare(
    "INSERT INTO rag_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)"
  );
  const insertMany = db.transaction(() => {
    for (let i = 0; i < chunks.length; i += 1) {
      const doc = chunks[i];
      const embedding = embeddings[i];
      const result = insertDoc.run(doc.title, doc.content, doc.url ?? null);
      insertVector.run(Number(result.lastInsertRowid), JSON.stringify(embedding));
    }
  });
  insertMany();
  setMeta(db, "ingest_signature", signature);
  setMeta(db, "ingest_count", String(chunks.length));
};

export type RagResponse = {
  text: string;
  sources: Array<{ title: string; url?: string }>;
  distance: number | null;
};

// Ensure only one indexing run at a time.
const ensureIndexed = async () => {
  if (!indexPromise) {
    indexPromise = indexDocuments().finally(() => {
      indexPromise = null;
    });
  }
  await indexPromise;
};

// Query the vector store and format a short answer with sources.
export const queryLocalRag = async (input: string): Promise<RagResponse> => {
  if (!input.trim()) {
    return {
      text: "不知道。",
      sources: [],
      distance: null,
    };
  }
  // Lazy index build on first query or when files change.
  await ensureIndexed();
  const [embedding] = await embedTexts([input]);
  const db = getDb();
  const requestedTopK = Number(process.env.RAG_TOP_K ?? DEFAULT_TOP_K);
  const topK = Number.isFinite(requestedTopK)
    ? Math.max(1, Math.min(requestedTopK, 50))
    : DEFAULT_TOP_K;
  // vec0 requires k to be supplied for KNN queries.
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
    JOIN rag_docs ON rag_docs.id = rag_vectors.rowid
      WHERE rag_vectors.embedding MATCH ? AND k = ?
      ORDER BY rag_vectors.distance
      
    `
    )
    .all(JSON.stringify(embedding), topK) as RagMatch[];
  console.log("[local-rag] distances", rows.map((row) => row.distance));
  if (rows.length === 0) {
    return {
      text: "不知道。",
      sources: [],
      distance: null,
    };
  }
  const best = rows[0];
  const answer = best ? clip(normalizeAnswer(best.content), 360) : "不知道。";
  return {
    text: answer,
    sources: best ? [{ title: best.title, url: best.url }] : [],
    distance: best?.distance ?? null,
  };
};
