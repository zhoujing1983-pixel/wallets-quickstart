import crypto from "crypto";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type OtpEntry = {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

const otpStore = new Map<string, OtpEntry>();

const hashCode = (code: string) =>
  crypto.createHash("sha256").update(code).digest("hex");

const cleanupExpired = () => {
  const now = Date.now();
  for (const [key, entry] of otpStore.entries()) {
    if (entry.expiresAt <= now) {
      otpStore.delete(key);
    }
  }
};

export const createEmailOtp = (email: string, code: string) => {
  cleanupExpired();
  const emailId = crypto.randomUUID();
  const expiresAt = Date.now() + OTP_TTL_MS;
  otpStore.set(emailId, {
    email,
    codeHash: hashCode(code),
    expiresAt,
    attempts: 0,
  });
  return { emailId, expiresAt };
};

export const verifyEmailOtp = (
  emailId: string,
  email: string,
  code: string
) => {
  const entry = otpStore.get(emailId);
  if (!entry) {
    return { ok: false, error: "code_not_found" as const };
  }
  if (entry.expiresAt <= Date.now()) {
    otpStore.delete(emailId);
    return { ok: false, error: "code_expired" as const };
  }
  if (entry.email !== email) {
    return { ok: false, error: "email_mismatch" as const };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(emailId);
    return { ok: false, error: "too_many_attempts" as const };
  }
  const matches = entry.codeHash === hashCode(code);
  if (!matches) {
    entry.attempts += 1;
    otpStore.set(emailId, entry);
    return { ok: false, error: "invalid_code" as const };
  }
  otpStore.delete(emailId);
  return { ok: true as const };
};

export const buildOtpEmail = (code: string) => {
  const safeCode = code.replace(/[^0-9]/g, "");
  return {
    subject: "Your Finyx verification code",
    text: `Your Finyx verification code is ${safeCode}. This code expires in 10 minutes.`,
    html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Finyx Verification</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:Arial, sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;background:#ffffff;border-radius:24px;border:1px solid #e2e8f0;box-shadow:0 24px 60px rgba(15,23,42,0.08);">
            <tr>
              <td style="padding:32px;">
                <p style="font-size:12px;letter-spacing:0.3em;text-transform:uppercase;color:#64748b;margin:0 0 12px 0;">Finyx Wallet Access</p>
                <h1 style="font-size:26px;margin:0 0 8px 0;color:#0f172a;">Verify your email</h1>
                <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 24px 0;">
                  Use the code below to finish signing in. This code expires in 10 minutes.
                </p>
                <div style="background:#f1f5f9;border-radius:16px;padding:20px;text-align:center;">
                  <span style="font-size:24px;letter-spacing:0.4em;font-weight:700;color:#0f172a;">${safeCode}</span>
                </div>
                <p style="font-size:12px;color:#94a3b8;margin:24px 0 0 0;">
                  If you did not request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
};
