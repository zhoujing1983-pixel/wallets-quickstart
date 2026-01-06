import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { isEmailValid } from "@crossmint/common-sdk-auth";
import {
  buildTransferOtpEmail,
  createTransferOtp,
  getLatestTransferOtp,
  getTransferResendAvailableAt,
} from "@/lib/email-otp";
import { getEmailQueue } from "@/lib/email-queue";
import crypto from "crypto";

export const runtime = "nodejs";

const EMAIL_COOKIE = "finyx_email";
const smtpHost = process.env.SMTP_HOST ?? "";
const smtpPort = Number(process.env.SMTP_PORT ?? "465");
const smtpUser = process.env.SMTP_USER ?? "";
const smtpPass = process.env.SMTP_PASS ?? "";
const smtpSecure = (process.env.SMTP_SECURE ?? "true").toLowerCase() === "true";
const mailFrom = process.env.MAIL_FROM ?? smtpUser;
const contactTo = process.env.CONTACT_TO ?? "";

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

export async function POST(req: NextRequest) {
  const email = req.cookies.get(EMAIL_COOKIE)?.value ?? "";
  if (!email) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  if (!isEmailValid(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!smtpHost || !smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: "smtp_not_configured" },
      { status: 500 }
    );
  }

  const resendAvailableAt = await getTransferResendAvailableAt(email);
  if (resendAvailableAt && resendAvailableAt > Date.now()) {
    const latest = await getLatestTransferOtp(email);
    return NextResponse.json(
      {
        error: "resend_not_available",
        resendAvailableAt,
        emailId: latest?.emailId ?? null,
        expiresAt: latest?.expiresAt ?? null,
      },
      { status: 429 }
    );
  }

  const code = crypto.randomInt(0, 10_000_000_000).toString().padStart(10, "0");
  const {
    emailId,
    expiresAt,
    resendAvailableAt: nextResendAvailableAt,
  } = await createTransferOtp(email, code);
  const message = buildTransferOtpEmail(code);

  const queue = getEmailQueue();
  if (queue) {
    try {
      await queue.add(
        "send-transfer-otp",
        {
          from: mailFrom,
          to: email,
          bcc: contactTo && contactTo !== email ? contactTo : undefined,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        {
          removeOnComplete: true,
          removeOnFail: 100,
        }
      );
    } catch (err: unknown) {
      console.error("Transfer OTP queue enqueue failed", err);
    } finally {
      await queue.close();
    }
  } else {
    try {
      void transporter
        .sendMail({
          from: mailFrom,
          to: email,
          bcc: contactTo && contactTo !== email ? contactTo : undefined,
          subject: message.subject,
          text: message.text,
          html: message.html,
        })
        .catch((err: unknown) => {
          console.error("SMTP send failed", err);
        });
    } catch (err: unknown) {
      console.error("SMTP send failed", err);
    }
  }

  return NextResponse.json({
    emailId,
    expiresAt,
    resendAvailableAt: nextResendAvailableAt,
  });
}
