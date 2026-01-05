"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

type EmailOtpModalProps = {
  open: boolean;
  email?: string;
  otp: string;
  resendSeconds: number;
  isSubmitting: boolean;
  error?: string | null;
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
  error,
  onClose,
  onOtpChange,
  onConfirm,
  onResend,
}: EmailOtpModalProps) {
  if (!open) return null;

  const otpChars = useMemo(() => otp.split("").slice(0, 6), [otp]);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [highlightFilled, setHighlightFilled] = useState(false);
  const [lastFocusedIndex, setLastFocusedIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (otpChars.some(Boolean)) return;
    inputRefs.current[0]?.focus();
  }, [open, otpChars]);

  useEffect(() => {
    if (!highlightFilled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        handleHighlightInput();
        return;
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        handleHighlightInput(event.key);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [highlightFilled]);

  const focusInput = (index: number) => {
    const target = inputRefs.current[index];
    if (!target) return;
    setLastFocusedIndex(index);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => target.focus());
    } else {
      setTimeout(() => target.focus(), 0);
    }
  };

  const handleHighlightInput = (digit?: string) => {
    const nextValue = digit ? digit : "";
    onOtpChange(nextValue);
    setHighlightFilled(false);
    focusInput(digit ? 1 : 0);
  };

  const setOtpAt = (index: number, value: string) => {
    const sanitized = value.replace(/\D/g, "");
    if (!sanitized) return;
    const startIndex = highlightFilled ? getFirstEmptyIndex() : index;
    const current = Array.from({ length: 6 }).map((_, i) => otpChars[i] ?? "");
    sanitized.split("").forEach((char, offset) => {
      const targetIndex = startIndex + offset;
      if (targetIndex < current.length) {
        current[targetIndex] = char;
      }
    });
    onOtpChange(current.join(""));
    if (sanitized.length > 0) {
      const nextIndex = Math.min(startIndex + sanitized.length, 5);
      if (nextIndex != startIndex) {
        focusInput(nextIndex);
      }
    }
  };

  const handleBackspace = (index: number) => {
    const current = Array.from({ length: 6 }).map((_, i) => otpChars[i] ?? "");
    if (current[index]) {
      current[index] = "";
      onOtpChange(current.join(""));
      focusInput(index);
      return;
    }
    const prevIndex = Math.max(index - 1, 0);
    current[prevIndex] = "";
    onOtpChange(current.join(""));
    focusInput(prevIndex);
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
      focusInput(nextIndex);
    }
  };

  const getFirstEmptyIndex = () => {
    for (let i = 0; i < 6; i += 1) {
      if (!otpChars[i]) return i;
    }
    return 5;
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    index: number
  ) => {
    if (highlightFilled) {
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        handleHighlightInput();
        return;
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        handleHighlightInput(event.key);
        return;
      }
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      handleBackspace(index);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focusInput(getFirstEmptyIndex());
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
          {error ? (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-rose-400 text-[11px] font-semibold text-rose-500">!
              </span>
              <span>{error}</span>
            </div>
          ) : null}
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
                readOnly={index !== getFirstEmptyIndex()}
                onChange={(event) => setOtpAt(index, event.target.value)}
                onFocus={(event) => {
                  const firstEmpty = getFirstEmptyIndex();
                  if (highlightFilled) {
                    event.preventDefault();
                    event.currentTarget.blur();
                    return;
                  }
                  if (index !== firstEmpty && index !== lastFocusedIndex) {
                    event.preventDefault();
                    focusInput(firstEmpty);
                    return;
                  }
                  setLastFocusedIndex(index);
                  event.currentTarget.select();
                }}
                onMouseDown={(event) => {
                  const firstEmpty = getFirstEmptyIndex();
                  if (highlightFilled) {
                    event.preventDefault();
                    setHighlightFilled(false);
                    focusInput(lastFocusedIndex);
                    return;
                  }
                  if (index !== firstEmpty && index !== lastFocusedIndex) {
                    event.preventDefault();
                    focusInput(firstEmpty);
                  }
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  if (index !== lastFocusedIndex) {
                    inputRefs.current[lastFocusedIndex]?.blur();
                    setHighlightFilled(true);
                    return;
                  }
                  setHighlightFilled(true);
                  event.currentTarget.blur();
                }}
                onKeyDown={(event) => handleKeyDown(event, index)}
                onPaste={handlePaste}
                className={`h-12 w-12 rounded-xl border text-center text-lg font-semibold text-slate-900 outline-none transition focus:border-2 focus:border-slate-700 ${
                  otpChars[index] ? "bg-slate-100" : "bg-white"
                } ${
                  error
                    ? "border-rose-300 focus:border-rose-500"
                    : "border-slate-300"
                } ${
                  !error && highlightFilled && otpChars[index]
                    ? "border-2 border-slate-700"
                    : ""
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
