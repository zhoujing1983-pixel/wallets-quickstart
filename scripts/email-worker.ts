import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import nodemailer from "nodemailer";
import {
  EMAIL_QUEUE_NAME,
  EMAIL_QUEUE_PREFIX,
  type EmailJobData,
} from "../src/lib/email-queue";
import { getRedisDb, withRedisDb } from "../src/lib/redis-url";

const smtpHost = process.env.SMTP_HOST ?? "";
const smtpPort = Number(process.env.SMTP_PORT ?? "465");
const smtpUser = process.env.SMTP_USER ?? "";
const smtpPass = process.env.SMTP_PASS ?? "";
const smtpSecure = (process.env.SMTP_SECURE ?? "true").toLowerCase() === "true";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required to run the email worker.");
}
if (!smtpHost || !smtpUser || !smtpPass) {
  throw new Error("SMTP configuration is missing for the email worker.");
}

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

const connection = new IORedis(
  withRedisDb(
    process.env.REDIS_URL,
    getRedisDb(process.env.EMAIL_QUEUE_REDIS_DB),
  ),
  {
    maxRetriesPerRequest: null,
  },
);

const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    const { to, from, bcc, subject, text, html } = job.data;
    await transporter.sendMail({
      from,
      to,
      bcc,
      subject,
      text,
      html,
    });
  },
  {
    connection,
    prefix: EMAIL_QUEUE_PREFIX,
  },
);

worker.on("completed", (job) => {
  console.log(`[email-worker] sent job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[email-worker] failed job ${job?.id}`, err);
});
