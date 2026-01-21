import fs from "fs/promises";
import path from "path";

type SkillDefinition = {
  name: string;
  description: string;
  keywords: string[];
  body: string;
  references: Array<{ path: string; content: string }>;
  scripts: Array<{ path: string; content: string }>;
};

type Frontmatter = {
  name?: string;
  description?: string;
  keywords?: string[];
};

type SkillMatchOptions = {
  forceSkills?: string[];
};

const SKILLS_DIR =
  process.env.AGENT_SKILLS_DIR ?? path.join(process.cwd(), "skills");
const SKILL_DEBUG =
  (process.env.AGENT_SKILL_DEBUG ?? "").toLowerCase() === "true";
const SKILL_CACHE_TTL_MS = 30_000;
const MAX_FILE_BYTES = 40_000;
const MAX_TOTAL_BYTES = 160_000;
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

let cachedSkills: SkillDefinition[] | null = null;
let cachedAt = 0;

const normalize = (value: string) => value.toLowerCase();

const truncateContent = (content: string, maxBytes: number) => {
  const buffer = Buffer.from(content, "utf8");
  if (buffer.length <= maxBytes) {
    return content;
  }
  const truncated = buffer.subarray(0, maxBytes).toString("utf8");
  return `${truncated}\n...[truncated]`;
};

const parseFrontmatter = (content: string): { frontmatter: Frontmatter; body: string } => {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content.trim() };
  }
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }
  const raw = match[1];
  const body = content.slice(match[0].length).trim();
  const frontmatter: Frontmatter = {};
  let currentKey: "keywords" | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }
    const keyMatch = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      const [, key, value] = keyMatch;
      currentKey = null;
      if (key === "name") {
        frontmatter.name = value.replace(/^"|"$/g, "").trim();
      } else if (key === "description") {
        frontmatter.description = value.replace(/^"|"$/g, "").trim();
      } else if (key === "keywords") {
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
  const content = await fs.readFile(filePath, "utf8");
  return truncateContent(content, MAX_FILE_BYTES);
};

const loadSkillDefinition = async (skillDir: string) => {
  const skillPath = path.join(skillDir, "SKILL.md");
  const content = await fs.readFile(skillPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);
  const name = frontmatter.name ?? path.basename(skillDir);
  const description = frontmatter.description ?? "";
  const keywords = (frontmatter.keywords ?? []).map((keyword) => keyword.trim());

  const referenceDir = path.join(skillDir, "references");
  const scriptDir = path.join(skillDir, "scripts");
  const referenceFiles = await collectTextFiles(referenceDir);
  const scriptFiles = await collectTextFiles(scriptDir);

  const references = await Promise.all(
    referenceFiles.map(async (filePath) => ({
      path: path.relative(skillDir, filePath),
      content: await loadFileContents(filePath),
    }))
  );
  const scripts = await Promise.all(
    scriptFiles.map(async (filePath) => ({
      path: path.relative(skillDir, filePath),
      content: await loadFileContents(filePath),
    }))
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

const extractQueryKeywords = (skill: SkillDefinition) => {
  const candidates = new Set<string>();
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

const shouldTriggerSkill = (skill: SkillDefinition, query: string) => {
  const normalizedQuery = normalize(query);
  const candidates = extractQueryKeywords(skill);
  return candidates.some((keyword) => normalizedQuery.includes(keyword));
};

const loadSkills = async () => {
  const now = Date.now();
  if (cachedSkills && now - cachedAt < SKILL_CACHE_TTL_MS) {
    return cachedSkills;
  }

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

const formatFileSection = (
  label: string,
  files: Array<{ path: string; content: string }>
) => {
  if (files.length === 0) {
    return "";
  }
  const sections = files.map(
    (file) => `--- ${file.path} ---\n${file.content.trim()}`
  );
  return `${label}:\n${sections.join("\n\n")}`;
};

export const buildSkillContextPrefix = async (
  query: string,
  options?: SkillMatchOptions
) => {
  const skills = await loadSkills();
  const forcedNames = new Set(
    (options?.forceSkills ?? []).map((name) => normalize(name))
  );
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

  const blocks: string[] = [];
  let totalBytes = 0;

  for (const skill of matched) {
    const skillSections: string[] = [];
    skillSections.push(`[Skill: ${skill.name}]`);
    if (skill.description) {
      skillSections.push(`Description: ${skill.description}`);
    }
    if (skill.body) {
      skillSections.push(skill.body.trim());
    }
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
