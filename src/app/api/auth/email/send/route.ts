import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { isEmailValid } from "@crossmint/common-sdk-auth";
import {
  buildOtpEmail,
  createEmailOtp,
  getLatestEmailOtp,
  getResendAvailableAt,
} from "@/lib/email-otp";
import { getEmailQueue } from "@/lib/email-queue";
import crypto from "crypto";

export const runtime = "nodejs";

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
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim() : "";

  if (!email || !isEmailValid(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!smtpHost || !smtpUser || !smtpPass) {
    return NextResponse.json(
      { error: "smtp_not_configured" },
      { status: 500 }
    );
  }

  const resendAvailableAt = await getResendAvailableAt(email);
  if (resendAvailableAt && resendAvailableAt > Date.now()) {
    const latest = await getLatestEmailOtp(email);
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

  const code = crypto.randomInt(100000, 1000000).toString();
  const {
    emailId,
    expiresAt,
    resendAvailableAt: nextResendAvailableAt,
  } = await createEmailOtp(email, code);
  const message = buildOtpEmail(code);

  const queue = getEmailQueue();
  if (queue) {
    try {
      await queue.add(
        "send-otp",
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
      console.error("Email queue enqueue failed", err);
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
