/*
 * 文件作用：工具层实现：封装外部能力调用（航班、RAG、MCP 等）并提供统一工具输入输出。
 * 调用链阶段：能力执行阶段（检索/工具/数据解析）
 * 调用链关系：上游：src/agent/engine/workflow/direct-chat-workflow.ts::isWeatherIntent() 分支；下游：Open-Meteo 接口与 MCP server 工具注册。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
/**
 * MCP 天气服务
 * - 通过城市名进行地理编码，获取经纬度
 * - 通过经纬度调用 Open-Meteo 获取当前天气
 * - 以 stdio 方式对外提供 MCP 工具
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/** stdio 传输层：通过 stdin/stdout 与 MCP 客户端通信 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
/** Zod 用于定义工具的输入参数 schema */
import { z } from "zod";

/** 地理编码接口返回的字段结构（只保留需要的部分） */
type GeocodeResult = {
  name: string;
  admin1?: string;
  admin2?: string;
  country?: string;
  countryCode?: string;
  featureCode?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

/** 天气接口返回的结构（裁剪 + 补充语义字段） */
type CurrentWeather = {
  temperature: number;
  windspeed: number;
  weathercode: number;
  time: string;
  raw?: Record<string, unknown>;
  codeMeaning?: string;
  winddirection?: number;
  windDirectionMeaning?: string;
  pressure?: number;
  visibility?: number;
  humidity?: number;
};

/** Open-Meteo 地理编码接口 */
const OPEN_METEO_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
/** Open-Meteo 天气接口 */
const OPEN_METEO_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

/** 天气编码 => 中文含义对照表（Open-Meteo weathercode） */
const weatherCodeMeaning: Record<number, string> = {
  0: "晴朗",
  1: "主要晴朗",
  2: "局部多云",
  3: "阴天",
  45: "雾",
  48: "冻雾",
  51: "细雨",
  53: "中雨",
  55: "密集细雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "轻度冻雨",
  67: "重度冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "阵雨",
  81: "强阵雨",
  82: "暴雨",
  85: "小雪阵",
  86: "大雪阵",
  95: "雷暴",
  96: "雷阵雨伴随小冰雹",
  99: "雷阵雨伴随大冰雹",
};

/** MCP 工具入参：只接收城市名 */
const CitySchema = z
  .object({
    city: z.string().min(1).describe("城市名称，例如“上海”或“San Francisco”。"),
  })
  .strict();

/** MCP 服务实例 */
const server = new McpServer({
  name: "city-weather",
  version: "1.0.0",
});

/** 注册 MCP 工具：根据城市名返回当前天气 */
server.registerTool(
  "get_weather_by_city",
  {
    title: "City Weather",
    description: "根据城市名获取当前天气信息（先地理编码，再查询天气）。",
    inputSchema: CitySchema,
    /** 标记为只读工具，便于客户端策略判断 */
    annotations: { readOnlyHint: true },
  },
  async ({ city }) => {
    /** 先做地理编码：城市 -> 经纬度 */
    const location = await geocodeCity(city);
    if (!location) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "error",
                error_message: `无法根据“${city}”找到坐标，请尝试更准确的地名。`,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    /** 使用经纬度获取实时天气 */
    const weather = await fetchCurrentWeather(
      location.latitude,
      location.longitude,
    );
    if (!weather) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "error",
                error_message: `无法为 ${formatDisplayName(location)} 获取天气数据，请稍后重试。`,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    /** MCP 返回结构：text + structuredContent，便于不同客户端解析 */
    const payload = {
      status: "success",
      location: formatDisplayName(location),
      geocode: {
        name: location.name,
        admin1: location.admin1,
        admin2: location.admin2,
        country: location.country,
        countryCode: location.countryCode,
        featureCode: location.featureCode,
        timezone: location.timezone,
      },
      coordinates: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      weather,
      source: "open-meteo",
    };

    return {
      /** text 字段：人类可读 JSON */
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      /** structuredContent：结构化数据（机器可读） */
      structuredContent: payload,
    };
  },
);

/**
 * 将城市名解析为经纬度（Open-Meteo geocoding）
 * @param city 城市名称
 * @returns 地理坐标信息，失败时返回 null
 */
async function geocodeCity(city: string): Promise<GeocodeResult | null> {
  const trimmed = city.trim();
  if (!trimmed) {
    return null;
  }
  const encoded = encodeURIComponent(trimmed);
  const url = `${OPEN_METEO_GEOCODE_URL}?name=${encoded}&count=1&language=zh&format=json`;
  console.error("[weather-mcp] geocode request url", url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const first = payload?.results?.[0];
    if (!first) {
      return null;
    }
    /** 抽取并归一化经纬度字段 */
    const result = {
      name: first.name,
      admin1: first.admin1,
      admin2: first.admin2,
      country: first.country,
      countryCode: first.country_code,
      featureCode: first.feature_code,
      latitude: Number(first.latitude),
      longitude: Number(first.longitude),
      timezone: first.timezone,
    };
    console.error("[weather-mcp] geocode result", result);
    return result;
  } catch {
    return null;
  }
}

/**
 * 获取指定坐标的“当前天气”
 * @param latitude 纬度
 * @param longitude 经度
 * @returns 当前天气结构，失败时返回 null
 */
async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
): Promise<CurrentWeather | null> {
  const url = `${OPEN_METEO_WEATHER_URL}?latitude=${latitude}&longitude=${longitude}&current_weather=true&timezone=auto`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const current = payload?.current_weather;
    if (!current) {
      return null;
    }
    /** 字段裁剪 + 语义增强 */
    return {
      temperature: normalizeNumber(current.temperature),
      windspeed: normalizeNumber(current.windspeed),
      weathercode: normalizeNumber(current.weathercode),
      time: current.time,
      raw: current,
      codeMeaning: mapWeatherCode(current.weathercode),
      winddirection: normalizeNumber(current.winddirection),
      windDirectionMeaning: mapWindDirection(current.winddirection),
      pressure: normalizeNumber(current.pressure),
      visibility: normalizeNumber(current.visibility),
      humidity: normalizeNumber(current.relativehumidity),
    };
  } catch {
    return null;
  }
}

/**
 * 数值归一化：保留 1 位小数，异常则回退为 0
 * @param value 任意输入值
 * @returns 归一化后的数值
 */
function normalizeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 10) / 10;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
}

/**
 * weathercode -> 中文说明
 * @param code 天气代码
 * @returns 中文说明字符串
 */
function mapWeatherCode(code: number): string {
  const desc = weatherCodeMeaning[code] ?? `天气代码 ${code}`;
  return `weathercode ${code} => ${desc}`;
}

/**
 * 风向角度 -> 中文方位（16 分位简化为 8 方位）
 * @param degrees 风向角度（0-360）
 * @returns 中文方位名称
 */
function mapWindDirection(degrees: unknown): string {
  if (typeof degrees !== "number" || Number.isNaN(degrees)) {
    return "未知方向";
  }
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return "北风";
  if (normalized < 67.5) return "东北风";
  if (normalized < 112.5) return "东风";
  if (normalized < 157.5) return "东南风";
  if (normalized < 202.5) return "南风";
  if (normalized < 247.5) return "西南风";
  if (normalized < 292.5) return "西风";
  return "西北风";
}

/**
 * 拼接友好的城市显示名称
 * @param location 地理编码结果
 * @returns 形如 “城市, 州/省, 国家” 的显示字符串
 */
function formatDisplayName(location: GeocodeResult): string {
  const parts = [location.name, location.admin1, location.country].filter(
    Boolean,
  );
  return parts.join(", ");
}

/**
 * MCP 服务入口：以 stdio 方式连接
 * @returns 启动流程完成后的 Promise
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** 启动失败时输出错误并退出进程 */
main().catch((error) => {
  console.error("[weather-mcp] failed to start", error);
  process.exit(1);
});