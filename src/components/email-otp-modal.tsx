"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, CSSProperties, KeyboardEvent } from "react";

const OTP_LENGTH = 6;
const shouldDebug = process.env.NODE_ENV !== "production";

const sanitizeCode = (value: string) => value.replace(/\D/g, "").slice(0, OTP_LENGTH);

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
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const otpChars = useMemo(() => otp.split("").slice(0, OTP_LENGTH), [otp]);

  useEffect(() => {
    if (!open) return;
    hiddenInputRef.current?.focus();
    const highlight = window.setTimeout(() => {
      const first = inputRefs.current[0];
      if (first) {
        first.focus();
      }
    }, 120);
    return () => window.clearTimeout(highlight);
  }, [open]);

  if (!open) return null;

  type CSSVarStyle = CSSProperties & Record<string, string>;
  const containerStyle: CSSVarStyle = {
    "--otp-size": "48px",
    "--otp-gap": "10px",
    width: "calc(var(--otp-size) * 6 + var(--otp-gap) * 5)",
  };

  const handleHiddenInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeCode(event.target.value);
    if (shouldDebug) {
      console.debug("hidden otp change:", next);
    }
    if (next !== otp) {
      onOtpChange(next);
    }
  };

  const handleHiddenInputPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const next = sanitizeCode(event.clipboardData?.getData("text") ?? "");
    if (!next) return;
    if (shouldDebug) {
      console.debug("hidden otp paste:", next);
    }
    onOtpChange(next);
  };

  const focusHiddenInput = () => hiddenInputRef.current?.focus();

  const [highlightCount, setHighlightCount] = useState(0);

  const focusInput = (index: number) => {
    const target = inputRefs.current[index];
    if (!target) return;
    target.focus();
  };

  const clearHighlighted = () => {
    if (highlightCount <= 0) return;
    const chars = Array.from({ length: OTP_LENGTH }, (_, i) =>
      i < highlightCount ? "" : otpChars[i] ?? ""
    );
    onOtpChange(chars.join("").slice(0, OTP_LENGTH));
    setHighlightCount(0);
    focusInput(0);
  };

  const setOtpAt = (index: number, value: string) => {
    const sanitized = value.replace(/\D/g, "");
    if (!sanitized) return;
    const digit = sanitized.at(-1) ?? "";
    if (highlightCount > 0) {
      const cleared = Array(OTP_LENGTH).fill("");
      cleared[0] = digit;
      onOtpChange(cleared.join(""));
      setHighlightCount(0);
      const next = inputRefs.current[1];
      if (next) next.focus();
      return;
    }
    const current = otp.split("");
    while (current.length < OTP_LENGTH) {
      current.push("");
    }
    const targetIndex = (() => {
      for (let i = 0; i <= index; i += 1) {
        if (!current[i]) {
          return i;
        }
      }
      return index;
    })();
    current[targetIndex] = digit;
    onOtpChange(current.join("").slice(0, OTP_LENGTH));
    const focusIndex = (() => {
      for (let i = targetIndex + 1; i < OTP_LENGTH; i += 1) {
        if (!current[i]) {
          return i;
        }
      }
      return targetIndex + 1 < OTP_LENGTH ? targetIndex + 1 : targetIndex;
    })();
    focusInput(focusIndex);
  };

  const handleBackspace = (index: number) => {
    const chars = otp.split("");
    if (chars[index]) {
      chars[index] = "";
      onOtpChange(chars.join("").slice(0, OTP_LENGTH));
      return;
    }
    if (index > 0) {
      chars[index - 1] = "";
      onOtpChange(chars.join("").slice(0, OTP_LENGTH));
      const prev = inputRefs.current[index - 1];
      if (prev) {
        prev.focus();
      }
    }
  };

  const handleDoubleClick = () => {
    const filled = otpChars.filter(Boolean).length;
    if (filled > 0) {
      setHighlightCount(filled);
    }
  };

  const cancelHighlight = () => {
    if (highlightCount > 0) {
      setHighlightCount(0);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (highlightCount > 0) {
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        clearHighlighted();
        return;
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        clearHighlighted();
        setOtpAt(0, event.key);
        return;
      }
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      handleBackspace(index);
    }
  };

  return (
    <div className="absolute -inset-3 z-50 flex items-center justify-center">
      <div className="relative h-full w-full rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
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
          <p className="text-sm font-semibold text-slate-700">{email ?? ""}</p>
        </div>

        <div className="mt-8 space-y-4">
          {error ? (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-rose-400 text-[11px] font-semibold text-rose-500">
                !
              </span>
              <span>{error}</span>
            </div>
          ) : null}
          <div className="mx-auto relative" style={containerStyle}>
            <div className="grid grid-cols-6 gap-[var(--otp-gap)]">
              {Array.from({ length: OTP_LENGTH }).map((_, index) => {
                const isHighlighted = index < highlightCount;
                return (
                  <input
                    key={`otp-slot-${index}`}
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
                    onFocus={() => focusInput(index)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                    onDoubleClick={handleDoubleClick}
                    onClick={cancelHighlight}
                    className={`flex h-[var(--otp-size)] w-[var(--otp-size)] items-center justify-center rounded-xl border text-center text-lg font-semibold outline-none transition ${
                      isHighlighted
                        ? "border-slate-500 bg-slate-100 text-slate-900 shadow-[0_0_0_4px_rgba(15,23,42,0.25)]"
                        : otpChars[index]
                          ? "border-slate-600 bg-slate-100 text-slate-900 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.15)]"
                          : "border-slate-300 bg-white text-slate-500"
                    }`}
                  />
                );
              })}
            </div>
            <input
              ref={hiddenInputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              value={otp}
              onChange={(event) => {
                const next = sanitizeCode(event.target.value);
                if (shouldDebug) {
                  console.debug("hidden otp change:", next);
                }
                if (next !== otp) {
                  onOtpChange(next);
                }
              }}
              onPaste={(event) => {
                event.preventDefault();
                const next = sanitizeCode(event.clipboardData?.getData("text") ?? "");
                if (shouldDebug) {
                  console.debug("hidden otp paste:", next);
                }
                if (next) {
                  onOtpChange(next);
                }
              }}
              className="absolute -left-[9999px] w-px h-px opacity-0"
              aria-hidden="true"
            />
          </div>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting || otpChars.filter(Boolean).length < OTP_LENGTH}
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
