import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

type GeocodeResult = {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

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

const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

const weatherCodeMeaning: Record<number, string> = {
  0: '晴朗',
  1: '主要晴朗',
  2: '局部多云',
  3: '阴天',
  45: '雾',
  48: '冻雾',
  51: '细雨',
  53: '中雨',
  55: '密集细雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '轻度冻雨',
  67: '重度冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  85: '小雪阵',
  86: '大雪阵',
  95: '雷暴',
  96: '雷阵雨伴随小冰雹',
  99: '雷阵雨伴随大冰雹',
};

const CitySchema = z
  .object({
    city: z.string().min(1).describe('城市名称，例如“上海”或“San Francisco”。'),
  })
  .strict();

const server = new McpServer({
  name: 'city-weather',
  version: '1.0.0',
});

server.registerTool(
  'get_weather_by_city',
  {
    title: 'City Weather',
    description: '根据城市名获取当前天气信息（先地理编码，再查询天气）。',
    inputSchema: CitySchema,
    annotations: { readOnlyHint: true },
  },
  async ({ city }) => {
    const location = await geocodeCity(city);
    if (!location) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { status: 'error', error_message: `无法根据“${city}”找到坐标，请尝试更准确的地名。` },
              null,
              2
            ),
          },
        ],
      };
    }

    const weather = await fetchCurrentWeather(location.latitude, location.longitude);
    if (!weather) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { status: 'error', error_message: `无法为 ${formatDisplayName(location)} 获取天气数据，请稍后重试。` },
              null,
              2
            ),
          },
        ],
      };
    }

    const payload = {
      status: 'success',
      location: formatDisplayName(location),
      coordinates: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      weather,
      source: 'open-meteo',
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }
);

async function geocodeCity(city: string): Promise<GeocodeResult | null> {
  const trimmed = city.trim();
  if (!trimmed) {
    return null;
  }
  const encoded = encodeURIComponent(trimmed);
  const url = `${OPEN_METEO_GEOCODE_URL}?name=${encoded}&count=1&language=zh&format=json`;
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
    return {
      name: first.name,
      admin1: first.admin1,
      country: first.country,
      latitude: Number(first.latitude),
      longitude: Number(first.longitude),
      timezone: first.timezone,
    };
  } catch {
    return null;
  }
}

async function fetchCurrentWeather(latitude: number, longitude: number): Promise<CurrentWeather | null> {
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

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 10) / 10;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
}

function mapWeatherCode(code: number): string {
  const desc = weatherCodeMeaning[code] ?? `天气代码 ${code}`;
  return `weathercode ${code} => ${desc}`;
}

function mapWindDirection(degrees: unknown): string {
  if (typeof degrees !== 'number' || Number.isNaN(degrees)) {
    return '未知方向';
  }
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return '北风';
  if (normalized < 67.5) return '东北风';
  if (normalized < 112.5) return '东风';
  if (normalized < 157.5) return '东南风';
  if (normalized < 202.5) return '南风';
  if (normalized < 247.5) return '西南风';
  if (normalized < 292.5) return '西风';
  return '西北风';
}

function formatDisplayName(location: GeocodeResult): string {
  const parts = [location.name, location.admin1, location.country].filter(Boolean);
  return parts.join(', ');
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[weather-mcp] failed to start', error);
  process.exit(1);
});
