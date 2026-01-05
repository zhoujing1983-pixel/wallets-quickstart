export const getRedisDb = (value: string | undefined, fallback = 0) => {
  const raw = Number(value ?? `${fallback}`);
  if (!Number.isFinite(raw)) return fallback;
  if (raw < 0) return fallback;
  return Math.floor(raw);
};

export const withRedisDb = (url: string, db: number) => {
  try {
    const parsed = new URL(url);
    parsed.pathname = `/${db}`;
    return parsed.toString();
  } catch {
    return url;
  }
};
