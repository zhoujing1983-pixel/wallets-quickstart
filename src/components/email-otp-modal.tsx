"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";

type EmailOtpModalProps = {
  open: boolean;
  email?: string;
  otp: string;
  resendSeconds: number;
  isSubmitting: boolean;
  onClose: () => void;
  onOtpChange: (value: string) => void;
  onConfirm: () => void;
  onResend: () => void;
};

export function EmailOtpModal({
  open,
  email,
  otp,
  resendSeconds,
  isSubmitting,
  onClose,
  onOtpChange,
  onConfirm,
  onResend,
}: EmailOtpModalProps) {
  if (!open) return null;

  const otpChars = useMemo(() => otp.split("").slice(0, 6), [otp]);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    inputRefs.current[0]?.focus();
  }, [open, otpChars]);

  const setOtpAt = (index: number, value: string) => {
    const sanitized = value.replace(/\D/g, "");
    if (!sanitized) return;
    const current = Array.from({ length: 6 }).map((_, i) => otpChars[i] ?? "");
    sanitized.split("").forEach((char, offset) => {
      const targetIndex = index + offset;
      if (targetIndex < current.length) {
        current[targetIndex] = char;
      }
    });
    onOtpChange(current.join(""));
    const nextIndex = Math.min(index + sanitized.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleBackspace = (index: number) => {
    const current = Array.from({ length: 6 }).map((_, i) => otpChars[i] ?? "");
    if (current[index]) {
      current[index] = "";
      onOtpChange(current.join(""));
      return;
    }
    const prevIndex = Math.max(index - 1, 0);
    current[prevIndex] = "";
    onOtpChange(current.join(""));
    inputRefs.current[prevIndex]?.focus();
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    const current = Array.from({ length: 6 }).map((_, i) => otpChars[i] ?? "");
    text.slice(0, 6).split("").forEach((char, index) => {
      current[index] = char;
    });
    onOtpChange(current.join(""));
    const nextIndex = Math.min(text.length, 6) - 1;
    if (nextIndex >= 0) {
      inputRefs.current[nextIndex]?.focus();
    }
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    index: number
  ) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      handleBackspace(index);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      inputRefs.current[Math.max(index - 1, 0)]?.focus();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      inputRefs.current[Math.min(index + 1, 5)]?.focus();
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div className="relative h-full w-full rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <button
          type="button"
          className="absolute left-6 top-6 text-slate-500 hover:text-slate-900"
          aria-label="Back"
          onClick={onClose}
        >
          <span className="text-2xl">←</span>
        </button>
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 mt-2 flex items-center justify-center">
            <img
              src="/finyx-auth-logos/email-otp.svg"
              alt="Email verification"
              className="h-28 w-28"
              loading="lazy"
            />
          </div>
          <h3 className="text-[22px] font-semibold text-slate-900">
            Check your email
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            A temporary login code has been sent to
          </p>
          <p className="text-sm font-semibold text-slate-700">
            {email ?? ""}
          </p>
        </div>

        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <input
                key={`otp-modal-slot-${index}`}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                maxLength={1}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                aria-label={`Digit ${index + 1}`}
                value={otpChars[index] ?? ""}
                onChange={(event) => setOtpAt(index, event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => handleKeyDown(event, index)}
                onPaste={handlePaste}
                className={`h-12 w-12 rounded-xl border bg-white text-center text-lg font-semibold text-slate-900 outline-none transition focus:border-slate-700 ${
                  otpChars[index] ? "border-slate-700" : "border-slate-300"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting || otpChars.filter(Boolean).length < 6}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-600"
          >
            Confirm
          </button>
          <p className="text-center text-xs text-slate-500">
            Can&apos;t find the email? Check spam folder. Some emails may take
            several minutes to arrive.
          </p>
          <button
            type="button"
            onClick={onResend}
            disabled={isSubmitting || resendSeconds > 0}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed"
          >
            {resendSeconds > 0
              ? `Re-send code in ${resendSeconds}s`
              : "Resend code"}
          </button>
        </div>
      </div>
    </div>
  );
}
