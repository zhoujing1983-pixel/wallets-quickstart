import crypto from "crypto";
import { getRedisClient } from "@/lib/redis";
import { renderOtpEmailHtml } from "@/lib/email-templates/otp-email-template";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const OTP_REDIS_DB = Number.isFinite(Number(process.env.OTP_REDIS_DB))
  ? Number(process.env.OTP_REDIS_DB)
  : 0;

type OtpEntry = {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

type OtpError =
  | "code_not_found"
  | "code_expired"
  | "email_mismatch"
  | "too_many_attempts"
  | "invalid_code";

type OtpVerificationResult =
  | { ok: true }
  | { ok: false; error: OtpError };

type OtpService = {
  getResendAvailableAt: (email: string) => Promise<number | null>;
  getLatestEmailOtp: (
    email: string
  ) => Promise<{ emailId: string; expiresAt: number } | null>;
  getResendCooldownMs: () => number;
  createEmailOtp: (
    email: string,
    code: string
  ) => Promise<{ emailId: string; expiresAt: number; resendAvailableAt: number }>;
  verifyEmailOtp: (
    emailId: string,
    email: string,
    code: string
  ) => Promise<OtpVerificationResult>;
};

const hashCode = (code: string) =>
  crypto.createHash("sha256").update(code).digest("hex");

const createOtpService = (keyPrefix: string): OtpService => {
  const otpStore = new Map<string, OtpEntry>();
  const latestEmailIdStore = new Map<string, string>();
  const resendCooldownStore = new Map<string, number>();

  const getOtpKey = (emailId: string) => `${keyPrefix}:${emailId}`;
  const getLatestKey = (email: string) => `${keyPrefix}:latest:${email}`;
  const getResendKey = (email: string) => `${keyPrefix}:resend:${email}`;

  const cleanupExpired = () => {
    const now = Date.now();
    for (const [key, entry] of otpStore.entries()) {
      if (entry.expiresAt <= now) {
        otpStore.delete(key);
        const latestId = latestEmailIdStore.get(entry.email);
        if (latestId === key) {
          latestEmailIdStore.delete(entry.email);
          resendCooldownStore.delete(entry.email);
        }
      }
    }
  };

  const clearMemoryRefs = (email: string, emailId: string) => {
    if (latestEmailIdStore.get(email) === emailId) {
      latestEmailIdStore.delete(email);
      resendCooldownStore.delete(email);
    }
  };

  const getMemoryResendAvailableAt = (email: string) => {
    cleanupExpired();
    return resendCooldownStore.get(email) ?? null;
  };

  const getMemoryLatestEmailOtp = (email: string) => {
    cleanupExpired();
    const emailId = latestEmailIdStore.get(email);
    if (!emailId) return null;
    const entry = otpStore.get(emailId);
    if (!entry) {
      latestEmailIdStore.delete(email);
      resendCooldownStore.delete(email);
      return null;
    }
    return { emailId, expiresAt: entry.expiresAt };
  };

  const createMemoryOtp = (email: string, code: string) => {
    cleanupExpired();
    const emailId = crypto.randomUUID();
    const expiresAt = Date.now() + OTP_TTL_MS;
    const resendAvailableAt = Date.now() + RESEND_COOLDOWN_MS;
    otpStore.set(emailId, {
      email,
      codeHash: hashCode(code),
      expiresAt,
      attempts: 0,
    });
    latestEmailIdStore.set(email, emailId);
    resendCooldownStore.set(email, resendAvailableAt);
    return { emailId, expiresAt, resendAvailableAt };
  };

  const clearRedisLatestIfMatch = async (email: string, emailId: string) => {
    const client = await getRedisClient(OTP_REDIS_DB);
    if (!client) return;
    const latestKey = getLatestKey(email);
    const currentLatest = await client.get(latestKey);
    if (currentLatest === emailId) {
      await client.del([latestKey, getResendKey(email)]);
    }
  };

  const getResendAvailableAt = async (email: string) => {
    const client = await getRedisClient(OTP_REDIS_DB);
    if (!client) return getMemoryResendAvailableAt(email);
    const value = await client.get(getResendKey(email));
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getLatestEmailOtp = async (email: string) => {
    const client = await getRedisClient(OTP_REDIS_DB);
    if (!client) return getMemoryLatestEmailOtp(email);

    const emailId = await client.get(getLatestKey(email));
    if (!emailId) return null;

    const expiresAtValue = await client.hGet(getOtpKey(emailId), "expiresAt");
    if (!expiresAtValue) {
      await client.del([getLatestKey(email), getResendKey(email)]);
      return null;
    }

    const expiresAt = Number(expiresAtValue);
    return Number.isFinite(expiresAt) ? { emailId, expiresAt } : null;
  };

  const getResendCooldownMs = () => RESEND_COOLDOWN_MS;

  const createEmailOtp = async (email: string, code: string) => {
    const client = await getRedisClient(OTP_REDIS_DB);
    if (!client) return createMemoryOtp(email, code);

    const emailId = crypto.randomUUID();
    const expiresAt = Date.now() + OTP_TTL_MS;
    const resendAvailableAt = Date.now() + RESEND_COOLDOWN_MS;
    const ttlSeconds = Math.ceil(OTP_TTL_MS / 1000);

    const otpKey = getOtpKey(emailId);
    await client
      .multi()
      .hSet(otpKey, {
        email,
        codeHash: hashCode(code),
        expiresAt: expiresAt.toString(),
        attempts: "0",
      })
      .expire(otpKey, ttlSeconds)
      .set(getLatestKey(email), emailId, { EX: ttlSeconds })
      .set(getResendKey(email), resendAvailableAt.toString(), {
        EX: ttlSeconds,
      })
      .exec();

    return { emailId, expiresAt, resendAvailableAt };
  };

  const verifyEmailOtp = async (
    emailId: string,
    email: string,
    code: string
  ): Promise<OtpVerificationResult> => {
    const client = await getRedisClient(OTP_REDIS_DB);
    if (!client) {
      const entry = otpStore.get(emailId);
      if (!entry) {
        return { ok: false, error: "code_not_found" };
      }
      if (entry.expiresAt <= Date.now()) {
        otpStore.delete(emailId);
        clearMemoryRefs(email, emailId);
        return { ok: false, error: "code_expired" };
      }
      if (entry.email !== email) {
        return { ok: false, error: "email_mismatch" };
      }
      if (entry.attempts >= MAX_ATTEMPTS) {
        otpStore.delete(emailId);
        clearMemoryRefs(email, emailId);
        return { ok: false, error: "too_many_attempts" };
      }
      const matches = entry.codeHash === hashCode(code);
      if (!matches) {
        entry.attempts += 1;
        otpStore.set(emailId, entry);
        return { ok: false, error: "invalid_code" };
      }
      otpStore.delete(emailId);
      clearMemoryRefs(email, emailId);
      return { ok: true };
    }

    const otpKey = getOtpKey(emailId);
    const entry = await client.hGetAll(otpKey);
    if (!entry || Object.keys(entry).length === 0) {
      return { ok: false, error: "code_not_found" };
    }

    const entryEmail = entry.email;
    const expiresAt = Number(entry.expiresAt ?? 0);
    const attempts = Number(entry.attempts ?? 0);

    if (!entryEmail || !Number.isFinite(expiresAt)) {
      await client.del(otpKey);
      return { ok: false, error: "code_not_found" };
    }

    if (expiresAt <= Date.now()) {
      await client.del(otpKey);
      await clearRedisLatestIfMatch(entryEmail, emailId);
      return { ok: false, error: "code_expired" };
    }

    if (entryEmail !== email) {
      return { ok: false, error: "email_mismatch" };
    }

    if (attempts >= MAX_ATTEMPTS) {
      await client.del(otpKey);
      await clearRedisLatestIfMatch(entryEmail, emailId);
      return { ok: false, error: "too_many_attempts" };
    }

    const matches = entry.codeHash === hashCode(code);
    if (!matches) {
      await client.hIncrBy(otpKey, "attempts", 1);
      return { ok: false, error: "invalid_code" };
    }

    await client.del(otpKey);
    await clearRedisLatestIfMatch(entryEmail, emailId);
    return { ok: true };
  };

  return {
    getResendAvailableAt,
    getLatestEmailOtp,
    getResendCooldownMs,
    createEmailOtp,
    verifyEmailOtp,
  };
};

const loginOtpService = createOtpService("login-otp");
const transferOtpService = createOtpService("transfer-otp");

export const getResendAvailableAt = loginOtpService.getResendAvailableAt;
export const getLatestEmailOtp = loginOtpService.getLatestEmailOtp;
export const getResendCooldownMs = loginOtpService.getResendCooldownMs;
export const createEmailOtp = loginOtpService.createEmailOtp;
export const verifyEmailOtp = loginOtpService.verifyEmailOtp;

export const getTransferResendAvailableAt =
  transferOtpService.getResendAvailableAt;
export const getLatestTransferOtp = transferOtpService.getLatestEmailOtp;
export const getTransferResendCooldownMs =
  transferOtpService.getResendCooldownMs;
export const createTransferOtp = transferOtpService.createEmailOtp;
export const verifyTransferOtp = transferOtpService.verifyEmailOtp;

export const buildOtpEmail = (code: string) => {
  const safeCode = code.replace(/[^0-9]/g, "");
  return {
    subject: "Your login code for Finyx WaaS",
    text: `Your Finyx verification code is ${safeCode}. This code expires in 10 minutes.`,
    html: renderOtpEmailHtml(safeCode),
  };
};

export const buildTransferOtpEmail = (code: string) => {
  const safeCode = code.replace(/[^0-9]/g, "");
  return {
    subject: "Your transfer authorization code for Finyx WaaS",
    text: `Your Finyx transfer authorization code is ${safeCode}. This code expires in 10 minutes.`,
    html: renderOtpEmailHtml(safeCode, {
      heading: "Authorize your transfer",
      message:
        "Use the code below to approve this transfer. This code expires in 10 minutes.",
      tagline: "Finyx Transfer",
    }),
  };
};
