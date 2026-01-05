import { createClient } from "redis";
import { getRedisDb, withRedisDb } from "@/lib/redis-url";

type RedisClient = ReturnType<typeof createClient>;

const redisClientPromises = new Map<number, Promise<RedisClient>>();

export const getRedisClient = async (
  db?: number
): Promise<RedisClient | null> => {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const database = getRedisDb(db == null ? undefined : String(db));
  let redisClientPromise = redisClientPromises.get(database);

  if (!redisClientPromise) {
    const client = createClient({ url: withRedisDb(url, database) });
    client.on("error", (err) => {
      console.error("[redis] client error", err);
    });
    redisClientPromise = client.connect().then(() => client);
    redisClientPromises.set(database, redisClientPromise);
  }

  try {
    return await redisClientPromise;
  } catch (err) {
    console.error("[redis] connection failed", err);
    redisClientPromises.delete(database);
    return null;
  }
};
