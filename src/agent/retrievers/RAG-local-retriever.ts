import path from "path";
import fs from "node:fs";
import crypto from "node:crypto";
import { encode, decode } from "gpt-tokenizer";
import { parseExcel } from "@/lib/ingest/parse-excel";
import { parseWord } from "@/lib/ingest/parse-word";
import { parsePdf } from "@/lib/ingest/parse-pdf";
import type { VectorRecord, VectorStore } from "./vector-store";
import { SqliteVectorStore } from "./sqlite-vector-store";
import { PgVectorStore } from "./pg-vector-store";

// 采集到的原始文档（尚未切分）。
type RagDoc = {
  title: string;
  content: string;
  url?: string;
};

// 统一向量存储的元数据结构（用于展示与引用）。
type RagMetadata = {
  title: string;
  url?: string;
};

/*
 * 生产可用的默认值（均可被 .env 覆盖）：
 * - DEFAULT_INGEST_DIR: 默认从项目根目录的 rag-docs 读取文档。
 * - DEFAULT_EMBEDDING_MODEL: 默认使用的 embedding 模型名。
 * - DEFAULT_BASE_URL: 默认的 OpenAI-compatible embedding 服务地址（Qwen DashScope）。
 * - DEFAULT_VECTOR_BACKEND: 默认向量后端（sqlite | pg）。
 * - DEFAULT_CHUNK_TOKENS: 单个 chunk 的最大 token 数，影响召回粒度。
 * - DEFAULT_CHUNK_OVERLAP: chunk 之间重叠的 token 数，避免语义被切断。
 * - DEFAULT_TOP_K: 检索时返回的候选数量上限。
 * - DEFAULT_MAX_FILE_BYTES: ingest 时允许的单文件大小上限。
 * - DEFAULT_EMBEDDING_BATCH: 每次请求 embedding 的文本条数，控制请求体量。
 * - DEFAULT_EXTENSIONS: 允许被 ingest 的文件扩展名白名单。
 * - DEFAULT_EXCLUDES: ingest 扫描时需要跳过的目录/文件名。
 */
const DEFAULT_INGEST_DIR = path.join(process.cwd(), "rag-docs");
const DEFAULT_EMBEDDING_MODEL = "text-embedding-v3";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_VECTOR_BACKEND = "sqlite";
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

/*
 * 向量存储后端配置说明：
 * - RAG_VECTOR_BACKEND: sqlite | pg（默认 sqlite）；
 * - PGVECTOR_URL / DATABASE_URL: 当 backend=pg 时使用的连接串；
 * - LOCAL_RAG_DB_PATH: sqlite 后端数据库路径（保持兼容）。
 */

/*
 * 将片段裁剪到可读长度，避免响应过长：
 * - max 由调用方控制；超过长度会截断并加省略号。
 */
const clip = (text: string, max = 240) => {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
};

/*
 * 去掉 Markdown 标题并归一化空白，避免回答里残留格式噪音：
 * - 清除行首标题符号，压缩多余空白。
 */
const normalizeAnswer = (text: string) =>
  text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

/*
 * 预清洗文本：去除代码块与 HTML 标签，压缩空白。
 * - 目的：让切分和 embedding 更稳定、降低噪声。
 */
const cleanText = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/*
 * 按标题与空行将 Markdown 切成语义段：
 * - 标题处会断开；
 * - 空行也会断开；
 * - 让 chunk 更符合语义边界。
 */
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

/*
 * 基于 GPT BPE token 的切分：
 * - chunkSize 控制每块 token 数；
 * - overlap 用于相邻 chunk 重叠，避免语义被切断；
 * - 内部先清洗文本，再用 tokenizer 编码/解码。
 */
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

/*
 * 生成稳定的 chunk ID：
 * - 使用文档来源 + chunk 序号计算哈希；
 * - 便于后续替换/增量更新；
 * - 避免路径或标题包含特殊字符导致存储异常。
 */
const buildChunkId = (doc: RagDoc, index: number) => {
  const base = doc.url ?? doc.title;
  return crypto
    .createHash("sha256")
    .update(base)
    .update(`::${index}`)
    .digest("hex");
};

/*
 * 递归扫描 ingest 目录，按扩展名白名单收集文件路径：
 * - excludes 为需要跳过的目录或文件名；
 * - 仅保留白名单扩展名。
 */
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

/*
 * 按文件类型解析内容：
 * - pdf/docx/xlsx 走专用解析器；
 * - 其余文本类直接按 UTF-8 读取。
 */
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

/*
 * 生成内容签名（文件路径 + 大小 + mtime）：
 * - 用于判断 ingest 是否发生变化；
 * - 变化则需要重建索引。
 */
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

/*
 * 从磁盘加载 ingest 文档：
 * - 支持自定义目录、扩展名白名单、排除列表；
 * - 过滤超大文件；
 * - 返回文档数组与整体签名。
 */
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
  const maxBytes = Number(
    process.env.RAG_MAX_FILE_BYTES ?? DEFAULT_MAX_FILE_BYTES
  );
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
      // 解析失败的文件直接跳过，避免整个流程失败。
    }
  }
  return { docs, signature: computeSignature(files) };
};

/*
 * 从环境变量解析 embedding 配置：
 * - MODEL_PROVIDER 可切换 qwen / lmstudio；
 * - QWEN_* / LM_STUDIO_* 负责 key 与模型名；
 * - RAG_EMBEDDING_BASE_URL 可直接覆盖 baseURL。
 */
const getEmbeddingConfig = () => {
  const provider = (process.env.MODEL_PROVIDER ?? "qwen").toLowerCase();
  const apiKey =
    process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? "";
  const defaultBaseURL =
    provider === "lmstudio"
      ? process.env.LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1"
      : DEFAULT_BASE_URL;
  const baseURL =
    process.env.RAG_EMBEDDING_BASE_URL ??
    (provider === "lmstudio" ? undefined : process.env.QWEN_BASE_URL) ??
    defaultBaseURL;
  const model =
    process.env.RAG_EMBEDDING_MODEL ??
    (provider === "lmstudio"
      ? process.env.LM_STUDIO_EMBEDDING_MODEL ?? process.env.LM_STUDIO_MODEL
      : process.env.QWEN_EMBEDDING_MODEL) ??
    DEFAULT_EMBEDDING_MODEL;
  return { apiKey, baseURL, model };
};

/*
 * 批量调用 embeddings 接口：
 * - 支持本地 LM Studio（可无 API Key）；
 * - 其余情况要求 API Key；
 * - 返回每条文本的向量数组。
 */
const embedTexts = async (texts: string[]) => {
  const { apiKey, baseURL, model } = getEmbeddingConfig();
  const isLocalBase =
    baseURL.startsWith("http://127.0.0.1:1234") ||
    baseURL.startsWith("http://localhost:1234");
  if (!apiKey && !isLocalBase) {
    throw new Error(
      "Missing QWEN_API_KEY or DASHSCOPE_API_KEY for embeddings."
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey && !isLocalBase) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers,
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

// 向量存储单例（根据配置选择 sqlite 或 pg）。
let vectorStoreInstance: VectorStore<RagMetadata> | null = null;
// 记录当前使用的后端类型，避免重复创建。
let vectorStoreBackend: string | null = null;
// 避免并发建库，保证索引流程只有一个在跑。
let indexPromise: Promise<void> | null = null;

/*
 * 根据环境变量创建向量存储实例：
 * - RAG_VECTOR_BACKEND=sqlite|pg；
 * - 默认 sqlite，适合本地与轻量场景。
 */
const createVectorStore = () => {
  const backend = (process.env.RAG_VECTOR_BACKEND ?? DEFAULT_VECTOR_BACKEND)
    .trim()
    .toLowerCase();
  if (backend === "pg" || backend === "postgres" || backend === "postgresql") {
    return { backend, store: new PgVectorStore() };
  }
  return { backend: "sqlite", store: new SqliteVectorStore() };
};

/*
 * 获取向量存储实例（惰性初始化）：
 * - 仅在首次使用时创建；
 * - 允许通过环境变量切换后端；
 * - init 在此统一调用。
 */
const getVectorStore = async () => {
  const { backend, store } = createVectorStore();
  if (vectorStoreInstance && vectorStoreBackend === backend) {
    return vectorStoreInstance;
  }
  vectorStoreInstance = store;
  vectorStoreBackend = backend;
  await vectorStoreInstance.init();
  return vectorStoreInstance;
};

/*
 * 读取索引元数据：
 * - 使用 VectorStore 的可选 meta API；
 * - 若后端未实现则返回 null。
 */
const getMeta = async (store: VectorStore<RagMetadata>, key: string) => {
  if (!store.getMeta) return null;
  return store.getMeta(key);
};

/*
 * 写入索引元数据：
 * - 用于记录签名与索引数量；
 * - 若后端未实现则抛出错误。
 */
const setMeta = async (
  store: VectorStore<RagMetadata>,
  key: string,
  value: string
) => {
  if (!store.setMeta) {
    throw new Error("VectorStore does not support setMeta.");
  }
  await store.setMeta(key, value);
};

/*
 * 当源文档变更时，构建或刷新向量索引：
 * - 读取文档并计算签名；
 * - 对文本切分 chunk；
 * - 批量请求 embedding；
 * - 维度校验后重建向量表；
 * - 全量写入 rag_docs 与 rag_vectors；
 * - 更新签名与计数。
 */
const indexDocuments = async () => {
  const store = await getVectorStore();
  const { docs, signature } = await loadIngestDocs();
  const currentSignature = await getMeta(store, "ingest_signature");
  const force = (process.env.RAG_FORCE_REINDEX ?? "").toLowerCase() === "true";
  if (!force && currentSignature === signature) {
    // 文档未变化且未强制重建，直接复用已有索引。
    return;
  }
  const chunkSize = Number(
    process.env.RAG_CHUNK_TOKENS ?? DEFAULT_CHUNK_TOKENS
  );
  const overlap = Number(
    process.env.RAG_CHUNK_OVERLAP ?? DEFAULT_CHUNK_OVERLAP
  );
  /*
   * 文档切分流程：
   * - 先按 Markdown 语义分段；
   * - 再按 token 数切成固定大小 chunk；
   * - 每个 chunk 作为独立索引单元。
   */
  const chunks: Array<{
    id: string;
    title: string;
    content: string;
    url?: string;
  }> = [];
  for (const doc of docs) {
    const sections = splitMarkdown(doc.content);
    const slices: string[] = [];
    for (const section of sections) {
      slices.push(...chunkByTokens(section, chunkSize, overlap));
    }
    if (slices.length === 0) continue;
    for (let i = 0; i < slices.length; i += 1) {
      const id = buildChunkId(doc, i);
      chunks.push({
        id,
        title: slices.length > 1 ? `${doc.title} (chunk ${i + 1})` : doc.title,
        content: slices[i],
        url: doc.url,
      });
    }
  }
  if (chunks.length === 0) {
    // 没有可用 chunk，写入空计数并记录签名。
    await setMeta(store, "ingest_signature", signature);
    await setMeta(store, "ingest_count", "0");
    return;
  }
  /*
   * 分批 embedding：
   * - 将 title + content 拼接，提升语义信息；
   * - 以 batchSize 控制请求体量与速率。
   */
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
  const yellow = "\u001b[33m";
  const reset = "\u001b[0m";
  console.log(`${yellow}[local-rag] embedding dimension${reset}`, dimension);
  /*
   * 构建 VectorRecord 列表：
   * - 使用稳定 ID 方便后端去重/更新；
   * - metadata 保存 title/url，便于检索展示。
   */
  const records: VectorRecord<RagMetadata>[] = chunks.map((chunk, index) => ({
    id: chunk.id,
    embedding: embeddings[index],
    text: chunk.content,
    metadata: {
      title: chunk.title,
      url: chunk.url,
    },
  }));
  /*
   * 全量重建流程：
   * - 先清空旧索引；
   * - 再批量写入新记录；
   * - 由 VectorStore 负责具体实现细节。
   */
  if (!store.clear) {
    throw new Error("VectorStore does not support clear().");
  }
  await store.clear();
  await store.upsert(records, { dimension });
  // 更新索引签名与 chunk 数量。
  await setMeta(store, "ingest_signature", signature);
  await setMeta(store, "ingest_count", String(chunks.length));
};

export type RagResponse = {
  text: string;
  sources: Array<{ title: string; url?: string }>;
  // 统一语义的 score：越大越相关。
  score: number | null;
  // 原始距离（若后端提供 distance），用于旧阈值逻辑或调参。
  distance: number | null;
  /*
   * snippets 为检索到的多个片段：
   * - 用于为每个来源提供对应的上下文内容；
   * - 便于在提示词里按编号引用。
   */
  snippets?: Array<{
    title: string;
    url?: string;
    content: string;
    score: number;
    distance: number | null;
  }>;
};

// 确保一次只有一个索引任务在运行。
const ensureIndexed = async () => {
  if (!indexPromise) {
    indexPromise = indexDocuments().finally(() => {
      indexPromise = null;
    });
  }
  await indexPromise;
};

/*
 * 执行向量检索并拼装回答：
 * - 空输入直接返回“不知道”；
 * - 确保索引存在；
 * - 对 query 做 embedding；
 * - vec0 KNN 检索并取最相近片段；
 * - 返回最佳片段作为答案，同时提供多条片段用于引用。
 */
export const queryLocalRag = async (input: string): Promise<RagResponse> => {
  if (!input.trim()) {
    return {
      text: "不知道。",
      sources: [],
      score: null,
      distance: null,
    };
  }
  // Lazy index build on first query or when files change.
  await ensureIndexed();
  const [embedding] = await embedTexts([input]);
  const store = await getVectorStore();
  const requestedTopK = Number(process.env.RAG_TOP_K ?? DEFAULT_TOP_K);
  const topK = Number.isFinite(requestedTopK)
    ? Math.max(1, Math.min(requestedTopK, 50))
    : DEFAULT_TOP_K;
  /*
   * 统一向量检索：
   * - 由 VectorStore 内部适配 sqlite/pg；
   * - 统一返回 score（越大越相关）；
   * - rawScore/rawScoreType 保留后端原始值。
   */
  const matches = await store.query({
    embedding,
    topK,
  });
  const distances = matches.map((match) =>
    match.rawScoreType === "distance" ? match.rawScore ?? null : null
  );
  // 打印 score 与距离分布，便于调阈值与观察检索质量。
  console.log("[local-rag] scores", matches.map((match) => match.score));
  console.log("[local-rag] distances", distances);
  if (matches.length === 0) {
    return {
      text: "不知道。",
      sources: [],
      score: null,
      distance: null,
    };
  }
  const best = matches[0];
  const bestDistance =
    best.rawScoreType === "distance" ? best.rawScore ?? null : null;
  /*
   * 片段列表：
   * - 每条包含标题、URL、裁剪后的内容与 score/距离；
   * - 供上层做“按编号引用”的提示词拼接。
   */
  const snippets = matches.map((match) => ({
    title: match.metadata?.title ?? "Untitled",
    url: match.metadata?.url,
    content: clip(normalizeAnswer(match.text ?? ""), 360),
    score: match.score,
    distance: match.rawScoreType === "distance" ? match.rawScore ?? null : null,
  }));
  // 只取最相近的一条作为简短回答正文，避免冗长。
  const answer = best
    ? clip(normalizeAnswer(best.text ?? ""), 360)
    : "不知道。";
  return {
    text: answer,
    // sources 与 snippets 对齐，返回所有检索命中的来源列表。
    sources: matches.map((match) => ({
      title: match.metadata?.title ?? "Untitled",
      url: match.metadata?.url,
    })),
    score: best?.score ?? null,
    distance: bestDistance,
    snippets,
  };
};
