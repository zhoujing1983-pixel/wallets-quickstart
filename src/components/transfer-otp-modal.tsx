"use client";

import { useMemo } from "react";

type TransferOtpModalProps = {
  open: boolean;
  step: "send" | "verify";
  email?: string | null;
  code: string;
  resendSeconds: number;
  isSubmitting: boolean;
  error?: string | null;
  introTitle?: string;
  introDescription?: string;
  onClose: () => void;
  onSendCode: () => void;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
};

export function TransferOtpModal({
  open,
  step,
  email,
  code,
  resendSeconds,
  isSubmitting,
  error,
  introTitle,
  introDescription,
  onClose,
  onSendCode,
  onCodeChange,
  onVerify,
  onResend,
}: TransferOtpModalProps) {
  const safeEmail = useMemo(() => email ?? "", [email]);
  const resolvedIntroTitle = introTitle ?? "Confirm it's you";
  const resolvedIntroDescription =
    introDescription ??
    "You're using this wallet for the first time on this device. Click 'Send code' to get a one-time verification code.";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-[520px] rounded-[32px] bg-white p-8 shadow-[0_28px_80px_rgba(15,23,42,0.35)]">
        <button
          type="button"
          className="absolute right-6 top-6 text-slate-400 hover:text-slate-700"
          aria-label="Close"
          onClick={onClose}
        >
          <span className="text-2xl">&times;</span>
        </button>

        {step === "send" ? (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-3xl font-semibold text-slate-900">
                {resolvedIntroTitle}
              </h3>
              <p className="text-sm text-slate-500">
                {resolvedIntroDescription}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                Send authorization code to
              </p>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <img
                  src="/finyx-auth-logos/email-otp.svg"
                  alt="Email"
                  className="h-10 w-10"
                />
                <span className="text-sm font-medium text-slate-700">
                  {safeEmail}
                </span>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSendCode}
                disabled={isSubmitting}
                className="flex-1 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
              >
                {isSubmitting ? "Sending..." : "Send code"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-full bg-slate-100">
                <img
                  src="/finyx-auth-logos/email-otp.svg"
                  alt="Email"
                  className="h-[86px] w-[86px]"
                />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-slate-900">
                  Check your email
                </h3>
                <p className="text-sm text-slate-500">
                  A temporary authorization code has been sent to
                </p>
                <p className="text-sm font-semibold text-slate-700">
                  {safeEmail}
                </p>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Enter code"
                value={code}
                maxLength={10}
                autoFocus
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, "");
                  onCodeChange(next.slice(0, 10));
                }}
                className="w-full bg-transparent text-sm text-slate-700 outline-none"
              />
              <button
                type="button"
                onClick={onVerify}
                disabled={isSubmitting || code.trim().length < 10}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
              >
                {isSubmitting ? "Submitting" : "Submit"}
              </button>
            </div>

            <p className="text-center text-xs text-slate-500">
              Can&apos;t find the email? Check spam folder. Some emails may take
              several minutes to arrive.
            </p>

            <button
              type="button"
              onClick={onResend}
              disabled={isSubmitting || resendSeconds > 0}
              className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed"
            >
              {resendSeconds > 0
                ? `Re-send code in ${resendSeconds}s`
                : "Resend code"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
