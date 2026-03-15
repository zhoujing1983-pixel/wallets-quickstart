/*
 * 文件作用：机场与城市映射能力：提供地名/IATA 解析，支撑 flight workflow 参数归一化。
 * 调用链阶段：能力执行阶段（检索/工具/数据解析）
 * 调用链关系：上游：src/agent/runtime/langchain/flight-runtime.ts::normalizeFlightInput()、src/agent/engine/workflow/flight-booking-workflow.ts；下游：CSV/JSON 机场索引加载与 resolveIataCode()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import fs from "fs";
import path from "path";

export type AirportIndex = {
  byCity: Record<string, string[]>;
  byName: Record<string, string[]>;
};

const AIRPORTS_INDEX_PATH =
  process.env.AIRPORTS_INDEX_PATH ??
  path.join(process.cwd(), "rag-docs/ourairports/airports-index.json");
const AIRPORTS_CSV_PATH =
  process.env.AIRPORTS_CSV_PATH ??
  path.join(process.cwd(), "rag-docs/ourairports/airports.csv");
const AIRPORTS_ALIAS_PATH =
  process.env.AIRPORTS_ALIAS_PATH ??
  path.join(process.cwd(), "rag-docs/ourairports/city-aliases.json");

const normalizeKey = (value: string) =>
  value
    .trim()
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[，,。.!！?？]/g, "")
    .replace(/(市|省|州|区|县)$/, "")
    .toLowerCase();

const parseCsvLine = (line: string) => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
};

export const buildAirportIndexFromCsv = (csv: string): AirportIndex => {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return { byCity: {}, byName: {} };
  }
  const header = parseCsvLine(lines[0]).map((col) => col.trim());
  const iataIndex = header.indexOf("iata_code");
  const cityIndex = header.indexOf("municipality");
  const nameIndex = header.indexOf("name");
  const byCity: Record<string, string[]> = {};
  const byName: Record<string, string[]> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const iata = row[iataIndex]?.trim();
    if (!iata || iata.length !== 3) {
      continue;
    }
    const code = iata.toUpperCase();
    const city = row[cityIndex]?.trim();
    const name = row[nameIndex]?.trim();
    if (city) {
      const key = normalizeKey(city);
      if (!byCity[key]) {
        byCity[key] = [];
      }
      if (!byCity[key].includes(code)) {
        byCity[key].push(code);
      }
    }
    if (name) {
      const key = normalizeKey(name);
      if (!byName[key]) {
        byName[key] = [];
      }
      if (!byName[key].includes(code)) {
        byName[key].push(code);
      }
    }
  }
  return { byCity, byName };
};

let cachedIndex: AirportIndex | null = null;
let cachedAliases: Record<string, string> | null = null;

const loadAirportIndex = (): AirportIndex | null => {
  if (cachedIndex) {
    return cachedIndex;
  }
  try {
    if (fs.existsSync(AIRPORTS_INDEX_PATH)) {
      const raw = fs.readFileSync(AIRPORTS_INDEX_PATH, "utf8");
      const parsed = JSON.parse(raw) as AirportIndex;
      cachedIndex = parsed;
      return cachedIndex;
    }
  } catch {
    // ignore
  }
  try {
    if (fs.existsSync(AIRPORTS_CSV_PATH)) {
      const raw = fs.readFileSync(AIRPORTS_CSV_PATH, "utf8");
      cachedIndex = buildAirportIndexFromCsv(raw);
      return cachedIndex;
    }
  } catch {
    // ignore
  }
  return null;
};

const loadAliases = (): Record<string, string> | null => {
  if (cachedAliases) {
    return cachedAliases;
  }
  try {
    if (fs.existsSync(AIRPORTS_ALIAS_PATH)) {
      const raw = fs.readFileSync(AIRPORTS_ALIAS_PATH, "utf8");
      const parsed = JSON.parse(raw) as Record<string, string>;
      cachedAliases = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          normalizeKey(key),
          value,
        ]),
      );
      return cachedAliases;
    }
  } catch {
    // ignore
  }
  return null;
};

export const resolveIataCode = (value: string) => {
  if (!value) return value;
  const trimmed = value
    .trim()
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[，,。.!！?？]/g, "")
    .replace(/(市|省|州|区|县)$/, "");
  if (/^[A-Za-z]{3}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const aliases = loadAliases();
  if (aliases) {
    const alias = aliases[normalizeKey(trimmed)];
    if (alias) {
      return alias;
    }
  }
  const index = loadAirportIndex();
  if (!index) {
    return trimmed;
  }
  const key = normalizeKey(trimmed);
  const byCity = index.byCity[key];
  if (byCity && byCity.length > 0) {
    return byCity[0];
  }
  const byName = index.byName[key];
  if (byName && byName.length > 0) {
    return byName[0];
  }
  return trimmed;
};