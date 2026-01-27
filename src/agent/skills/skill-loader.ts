import fs from "fs/promises";
import path from "path";

type SkillDefinition = {
  // 技能名称（用于匹配与展示）。
  name: string;
  // 技能简述（用于 prompt 或调试日志）。
  description: string;
  // 触发关键词列表（用于匹配用户 query）。
  keywords: string[];
  // 技能主体内容（来自 SKILL.md 正文）。
  body: string;
  // references 目录下的文本资源（相对路径 + 内容）。
  references: Array<{ path: string; content: string }>;
  // scripts 目录下的脚本资源（相对路径 + 内容）。
  scripts: Array<{ path: string; content: string }>;
};

type Frontmatter = {
  // 技能名称（frontmatter 可选覆盖）。
  name?: string;
  // 技能描述（frontmatter 可选覆盖）。
  description?: string;
  // 关键词数组（frontmatter 可选覆盖）。
  keywords?: string[];
};

type SkillMatchOptions = {
  // 强制命中的技能名列表（忽略 query 匹配）。
  forceSkills?: string[];
};

// 技能根目录（默认 <cwd>/skills，可由环境变量覆盖）。
const SKILLS_DIR =
  process.env.AGENT_SKILLS_DIR ?? path.join(process.cwd(), "skills");
// 是否打印技能匹配调试日志。
const SKILL_DEBUG =
  (process.env.AGENT_SKILL_DEBUG ?? "").toLowerCase() === "true";
// 技能缓存时间（毫秒）。
const SKILL_CACHE_TTL_MS = 30_000;
// 单文件最大读取字节数（避免内存膨胀）。
const MAX_FILE_BYTES = 40_000;
// 总上下文字节上限（避免 prompt 过长）。
const MAX_TOTAL_BYTES = 160_000;
// 允许读取的文本文件后缀集合。
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".sh",
]);

const INCLUDE_SKILL_REFERENCES =
  (process.env.AGENT_SKILL_INCLUDE_REFERENCES ?? "true").toLowerCase() !==
  "false";

// 缓存的技能列表（减少频繁 IO）。
let cachedSkills: SkillDefinition[] | null = null;
// 缓存时间戳（用于 TTL 判断）。
let cachedAt = 0;

// 统一小写化（用于匹配）。
const normalize = (value: string) => value.toLowerCase();

// 按字节数截断内容，避免超大文件进入上下文。
const truncateContent = (content: string, maxBytes: number) => {
  const buffer = Buffer.from(content, "utf8");
  if (buffer.length <= maxBytes) {
    return content;
  }
  const truncated = buffer.subarray(0, maxBytes).toString("utf8");
  return `${truncated}\n...[truncated]`;
};

// 解析 Markdown frontmatter（简化 YAML 解析，仅支持 name/description/keywords）。
const parseFrontmatter = (
  content: string,
): { frontmatter: Frontmatter; body: string } => {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content.trim() };
  }
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }
  // frontmatter 原始块与正文。
  const raw = match[1];
  const body = content.slice(match[0].length).trim();
  const frontmatter: Frontmatter = {};
  // 记录是否在读取 keywords 的列表语法。
  let currentKey: "keywords" | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }
    // 解析 `key: value` 形式。
    const keyMatch = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      const [, key, value] = keyMatch;
      currentKey = null;
      if (key === "name") {
        frontmatter.name = value.replace(/^"|"$/g, "").trim();
      } else if (key === "description") {
        frontmatter.description = value.replace(/^"|"$/g, "").trim();
      } else if (key === "keywords") {
        // keywords 支持行内数组或换行列表。
        const inline = value.trim();
        if (inline.startsWith("[")) {
          const cleaned = inline.replace(/^\[|\]$/g, "");
          frontmatter.keywords = cleaned
            .split(",")
            .map((entry) => entry.trim().replace(/^"|"$/g, ""))
            .filter(Boolean);
        } else if (inline) {
          frontmatter.keywords = [inline.replace(/^"|"$/g, "").trim()];
        } else {
          frontmatter.keywords = [];
          currentKey = "keywords";
        }
      }
      continue;
    }
    // 处理 `- keyword` 列表项。
    if (currentKey === "keywords") {
      const keywordMatch = trimmed.match(/^-\s*(.+)$/);
      if (keywordMatch) {
        const keyword = keywordMatch[1].replace(/^"|"$/g, "").trim();
        if (keyword) {
          frontmatter.keywords?.push(keyword);
        }
      }
    }
  }

  return { frontmatter, body };
};

const collectTextFiles = async (dir: string) => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    // 只收集可读取的文本文件。
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dir, entry.name))
      .filter((filePath) => TEXT_EXTENSIONS.has(path.extname(filePath)));
    return files;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const loadFileContents = async (filePath: string) => {
  // 读文件并进行大小截断。
  const content = await fs.readFile(filePath, "utf8");
  return truncateContent(content, MAX_FILE_BYTES);
};

// 加载单个技能目录的定义（SKILL.md + references + scripts）。
const loadSkillDefinition = async (skillDir: string) => {
  const skillPath = path.join(skillDir, "SKILL.md");
  const content = await fs.readFile(skillPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);
  // frontmatter 优先，否则使用目录名。
  const name = frontmatter.name ?? path.basename(skillDir);
  const description = frontmatter.description ?? "";
  const keywords = (frontmatter.keywords ?? []).map((keyword) =>
    keyword.trim(),
  );

  // 补充引用文件与脚本文件内容。
  const referenceDir = path.join(skillDir, "references");
  const scriptDir = path.join(skillDir, "scripts");
  const referenceFiles = INCLUDE_SKILL_REFERENCES
    ? await collectTextFiles(referenceDir)
    : [];
  const scriptFiles = await collectTextFiles(scriptDir);

  const references = await Promise.all(
    referenceFiles.map(async (filePath) => ({
      path: path.relative(skillDir, filePath),
      content: await loadFileContents(filePath),
    })),
  );
  const scripts = await Promise.all(
    scriptFiles.map(async (filePath) => ({
      path: path.relative(skillDir, filePath),
      content: await loadFileContents(filePath),
    })),
  );

  return {
    name,
    description,
    keywords,
    body,
    references,
    scripts,
  } satisfies SkillDefinition;
};

// 为技能生成匹配候选词（技能名/描述/关键词 + 拆词）。
const extractQueryKeywords = (skill: SkillDefinition) => {
  const candidates = new Set<string>();
  // 既保留原短语，也拆分为若干词。
  const addCandidate = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    candidates.add(trimmed);
    const words = trimmed.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (const word of words) {
      if (word.length >= 2) {
        candidates.add(word);
      }
    }
  };

  addCandidate(skill.name);
  addCandidate(skill.description);
  for (const keyword of skill.keywords) {
    addCandidate(keyword);
  }

  return Array.from(candidates).map(normalize);
};

// 判断 query 是否命中技能（简单包含匹配）。
const shouldTriggerSkill = (skill: SkillDefinition, query: string) => {
  const normalizedQuery = normalize(query);
  const candidates = extractQueryKeywords(skill);
  return candidates.some((keyword) => normalizedQuery.includes(keyword));
};

// 加载技能列表（带缓存与 TTL）。
const loadSkills = async () => {
  const now = Date.now();
  if (cachedSkills && now - cachedAt < SKILL_CACHE_TTL_MS) {
    return cachedSkills;
  }

  // 读取技能根目录下的子目录。
  let dirEntries: string[] = [];
  try {
    dirEntries = await fs.readdir(SKILLS_DIR);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      cachedSkills = [];
      cachedAt = now;
      return cachedSkills;
    }
    throw error;
  }

  // 拼接绝对路径，并逐个加载。
  const skillDirs = dirEntries.map((entry) => path.join(SKILLS_DIR, entry));
  const loadedSkills: SkillDefinition[] = [];

  for (const skillDir of skillDirs) {
    try {
      const stat = await fs.stat(skillDir);
      if (!stat.isDirectory()) {
        continue;
      }
      const skill = await loadSkillDefinition(skillDir);
      loadedSkills.push(skill);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        continue;
      }
      console.warn("[skills] failed to load", skillDir, error);
    }
  }

  cachedSkills = loadedSkills;
  cachedAt = now;
  return loadedSkills;
};

// 将文件集合格式化为文本段落（用于注入 prompt）。
const formatFileSection = (
  label: string,
  files: Array<{ path: string; content: string }>,
) => {
  if (files.length === 0) {
    return "";
  }
  const sections = files.map(
    (file) => `--- ${file.path} ---\n${file.content.trim()}`,
  );
  return `${label}:\n${sections.join("\n\n")}`;
};

export const buildSkillContextPrefix = async (
  query: string,
  options?: SkillMatchOptions,
) => {
  const skills = await loadSkills();
  // 强制匹配的技能集合（忽略 query）。
  const forcedNames = new Set(
    (options?.forceSkills ?? []).map((name) => normalize(name)),
  );
  // 通过 query 或 forceSkills 选出匹配技能。
  const matched = skills.filter((skill) => {
    if (shouldTriggerSkill(skill, query)) {
      return true;
    }
    if (forcedNames.size > 0 && forcedNames.has(normalize(skill.name))) {
      return true;
    }
    return false;
  });
  if (SKILL_DEBUG) {
    if (matched.length > 0) {
      const forcedMatched = matched
        .filter((skill) => forcedNames.has(normalize(skill.name)))
        .map((skill) => skill.name);
      console.log("[skills] matched", {
        matched: matched.map((skill) => skill.name),
        forced: forcedMatched,
      });
    } else {
      console.log("[skills] matched none");
    }
  }
  if (matched.length === 0) {
    return null;
  }

  // 按上限累计拼装技能块（避免超长）。
  const blocks: string[] = [];
  let totalBytes = 0;

  for (const skill of matched) {
    const skillSections: string[] = [];
    // 基本信息段落。
    skillSections.push(`[Skill: ${skill.name}]`);
    if (skill.description) {
      skillSections.push(`Description: ${skill.description}`);
    }
    if (skill.body) {
      skillSections.push(skill.body.trim());
    }
    // 参考资料与脚本段落。
    const referencesSection = formatFileSection("References", skill.references);
    if (referencesSection) {
      skillSections.push(referencesSection);
    }
    const scriptsSection = formatFileSection("Scripts", skill.scripts);
    if (scriptsSection) {
      skillSections.push(scriptsSection);
    }

    const block = skillSections.join("\n\n");
    const blockBytes = Buffer.byteLength(block, "utf8");
    if (totalBytes + blockBytes > MAX_TOTAL_BYTES) {
      break;
    }
    totalBytes += blockBytes;
    blocks.push(block);
  }

  if (blocks.length === 0) {
    return null;
  }

  return `Skill Context (use when relevant):\n\n${blocks.join("\n\n")}`;
};
