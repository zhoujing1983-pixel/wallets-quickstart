import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getRedisDb, withRedisDb } from "@/lib/redis-url";

export const EMAIL_QUEUE_NAME = "email";
export const EMAIL_QUEUE_PREFIX =
  process.env.EMAIL_QUEUE_PREFIX ?? "finyx-email";

export type EmailJobData = {
  to: string;
  from: string;
  bcc?: string;
  subject: string;
  text: string;
  html: string;
};

export const isEmailQueueEnabled = () =>
  process.env.EMAIL_QUEUE_ENABLED === "true";

const getRedisConnection = () => {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const db = getRedisDb(process.env.EMAIL_QUEUE_REDIS_DB);
  return new IORedis(withRedisDb(url, db), {
    maxRetriesPerRequest: null,
  });
};

export const getEmailQueue = () => {
  if (!isEmailQueueEnabled()) return null;
  const connection = getRedisConnection();
  if (!connection) return null;
  return new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
    connection,
    prefix: EMAIL_QUEUE_PREFIX,
  });
};
