"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { TransferOtpModal } from "@/components/transfer-otp-modal";

const OTP_SESSION_KEY = "finyx_transfer_otp_session";

type EmailTransferFundsProps = {
  walletAddress: string;
  onTransferSuccess?: () => void;
};

export function EmailTransferFunds({
  walletAddress,
  onTransferSuccess,
}: EmailTransferFundsProps) {
  const [recipient, setRecipient] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountInput, setAmountInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explorerLink, setExplorerLink] = useState<string | null>(null);
  const [pendingTransactionId, setPendingTransactionId] = useState<
    string | null
  >(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [otpStep, setOtpStep] = useState<"send" | "verify">("send");
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [otpEmailId, setOtpEmailId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpIsSubmitting, setOtpIsSubmitting] = useState(false);
  const [otpResendAvailableAt, setOtpResendAvailableAt] = useState<
    number | null
  >(null);
  const [otpResendSeconds, setOtpResendSeconds] = useState(0);
  const [otpAuthorized, setOtpAuthorized] = useState(false);
  const [otpPendingTransfer, setOtpPendingTransfer] = useState(false);
  const chain = (process.env.NEXT_PUBLIC_CHAIN ?? "solana").toLowerCase();
  const crossmintEnv = process.env.NEXT_PUBLIC_CROSSMINT_ENV ?? "staging";

  const canSubmit =
    Boolean(walletAddress) && Boolean(recipient) && amount != null;

  const buildExplorerUrl = (txId: string) => {
    if (!chain.includes("solana")) {
      return null;
    }
    const cluster = crossmintEnv === "production" ? "" : "?cluster=devnet";
    return `https://explorer.solana.com/tx/${txId}${cluster}`;
  };

  const getResendSeconds = (availableAt: number | null) => {
    if (!availableAt) return 0;
    const remainingMs = availableAt - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(OTP_SESSION_KEY);
    setOtpAuthorized(stored === "true");
  }, []);

  useEffect(() => {
    let active = true;
    const loadEmail = async () => {
      try {
        const res = await fetch("/api/auth/email/session");
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (active && typeof data?.email === "string") {
          setOtpEmail(data.email);
        }
      } catch (emailError) {
        // Ignore email lookup errors.
      }
    };
    loadEmail();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!otpResendAvailableAt) {
      setOtpResendSeconds(0);
      return;
    }
    setOtpResendSeconds(getResendSeconds(otpResendAvailableAt));
    const interval = window.setInterval(() => {
      setOtpResendSeconds(getResendSeconds(otpResendAvailableAt));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [otpResendAvailableAt]);

  useEffect(() => {
    if (!pendingTransactionId) {
      return;
    }
    let canceled = false;
    let attempts = 0;
    const maxAttempts = 15;

    const poll = async () => {
      if (canceled) return;
      attempts += 1;
      try {
        const res = await fetch(
          `/api/auth/email/transfer/status?walletLocator=${encodeURIComponent(
            walletAddress
          )}&transactionId=${encodeURIComponent(pendingTransactionId)}`
        );
        const data = await res.json();
        if (res.ok) {
          const transaction = data?.transaction ?? data;
          const txId =
            transaction?.onChain?.txId ??
            transaction?.txId ??
            data?.txId ??
            null;
          const explorer =
            transaction?.onChain?.explorerLink ??
            data?.onChain?.explorerLink ??
            (txId ? buildExplorerUrl(txId) : null);
          if (explorer) {
            setExplorerLink(explorer);
            setStatusMessage(null);
            setPendingTransactionId(null);
            return;
          }
          if (transaction?.status === "failed") {
            setError("Transfer failed.");
            setStatusMessage(null);
            setPendingTransactionId(null);
            return;
          }
        }
      } catch (pollError) {
        // Ignore transient polling errors.
      }
      if (attempts >= maxAttempts) {
        setStatusMessage(null);
        setPendingTransactionId(null);
      }
    };

    poll();
    const interval = window.setInterval(poll, 2000);
    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [pendingTransactionId, walletAddress, chain, crossmintEnv]);

  const openOtpModal = () => {
    setOtpOpen(true);
    if (otpResendAvailableAt && getResendSeconds(otpResendAvailableAt) > 0) {
      setOtpStep("verify");
    } else {
      setOtpStep("send");
      setOtpEmailId(null);
      setOtpResendAvailableAt(null);
      setOtpCode("");
    }
    setOtpError(null);
  };

  const handleSendOtp = async () => {
    setOtpIsSubmitting(true);
    setOtpError(null);
    try {
      const response = await fetch("/api/auth/email/transfer/otp/send", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          data?.error === "resend_not_available" &&
          typeof data?.resendAvailableAt === "number"
        ) {
          if (typeof data?.emailId === "string") {
            setOtpEmailId(data.emailId);
          }
          setOtpStep("verify");
          setOtpResendAvailableAt(data.resendAvailableAt);
          setOtpError("We already sent a code. Please check your inbox.");
          return;
        }
        throw new Error(data?.error ?? "Failed to send code");
      }
      if (typeof data?.emailId === "string") {
        setOtpEmailId(data.emailId);
      }
      setOtpStep("verify");
      const availableAt =
        typeof data?.resendAvailableAt === "number"
          ? data.resendAvailableAt
          : Date.now() + 60_000;
      setOtpResendAvailableAt(availableAt);
    } catch (err) {
      setOtpError("Failed to send code. Please try again.");
    } finally {
      setOtpIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpEmailId) {
      setOtpError("Please request a verification code first.");
      return;
    }
    if (otpCode.trim().length < 10) {
      setOtpError("Enter the 10-digit code.");
      return;
    }
    setOtpIsSubmitting(true);
    setOtpError(null);
    try {
      const response = await fetch("/api/auth/email/transfer/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: otpEmailId,
          code: otpCode.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorCode = typeof data?.error === "string" ? data.error : "";
        const errorMessage =
          errorCode === "code_not_found"
            ? "Code not found or expired. Please request a new code."
            : errorCode === "code_expired"
              ? "Code expired. Please request a new code."
              : errorCode === "invalid_code"
                ? "Invalid code. Please try again."
                : errorCode === "too_many_attempts"
                  ? "Too many attempts. Please request a new code."
                  : errorCode === "email_mismatch"
                    ? "Email mismatch. Please request a new code."
                    : errorCode === "invalid_code_format"
                      ? "Enter the 10-digit code."
                      : "Invalid code. Please try again.";
        setOtpError(errorMessage);
        return;
      }
      setOtpAuthorized(true);
      if (typeof window !== "undefined") {
        sessionStorage.setItem(OTP_SESSION_KEY, "true");
      }
      setOtpOpen(false);
      setOtpStep("send");
      setOtpCode("");
      if (otpPendingTransfer) {
        setOtpPendingTransfer(false);
        await performTransfer();
      }
    } catch (err) {
      setOtpError("Verification failed. Please try again.");
    } finally {
      setOtpIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (otpIsSubmitting) return;
    setOtpIsSubmitting(true);
    setOtpError(null);
    try {
      const response = await fetch("/api/auth/email/transfer/otp/send", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          data?.error === "resend_not_available" &&
          typeof data?.resendAvailableAt === "number"
        ) {
          if (typeof data?.emailId === "string") {
            setOtpEmailId(data.emailId);
          }
          setOtpResendAvailableAt(data.resendAvailableAt);
          setOtpError("Please wait before requesting another code.");
          return;
        }
        throw new Error(data?.error ?? "Failed to resend code");
      }
      if (typeof data?.emailId === "string") {
        setOtpEmailId(data.emailId);
      }
      const availableAt =
        typeof data?.resendAvailableAt === "number"
          ? data.resendAvailableAt
          : Date.now() + 60_000;
      setOtpResendAvailableAt(availableAt);
    } catch (err) {
      setOtpError("Failed to resend code. Please try again.");
    } finally {
      setOtpIsSubmitting(false);
    }
  };

  const performTransfer = async () => {
    if (!canSubmit) {
      alert("Transfer: missing required fields");
      return;
    }
    setIsLoading(true);
    setError(null);
    setExplorerLink(null);
    setPendingTransactionId(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/auth/email/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletLocator: walletAddress,
          recipient,
          amount: amount?.toString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error === "otp_required") {
          setOtpAuthorized(false);
          if (typeof window !== "undefined") {
            sessionStorage.removeItem(OTP_SESSION_KEY);
          }
          setOtpPendingTransfer(true);
          openOtpModal();
          return;
        }
        const message =
          data?.details?.message ||
          data?.details?.error ||
          data?.error ||
          "Failed to transfer funds";
        setError(message);
        return;
      }
      const transaction = data?.transaction ?? data;
      const transactionId = transaction?.id ?? data?.id ?? null;
      const txId =
        transaction?.onChain?.txId ??
        transaction?.txId ??
        data?.onChain?.txId ??
        data?.txId ??
        null;
      let explorer =
        transaction?.onChain?.explorerLink ?? data?.onChain?.explorerLink ?? null;
      if (!explorer && txId) {
        explorer = buildExplorerUrl(txId);
      }
      if (explorer) {
        setExplorerLink(explorer);
      } else if (transactionId) {
        setStatusMessage("Waiting for confirmation...");
        setPendingTransactionId(transactionId);
      }
      onTransferSuccess?.();
    } catch (err) {
      setError("Failed to transfer funds.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!canSubmit) {
      alert("Transfer: missing required fields");
      return;
    }
    if (!otpAuthorized) {
      setOtpPendingTransfer(true);
      openOtpModal();
      return;
    }
    await performTransfer();
  };

  return (
    <div className="bg-[#27395d] border border-white/15 rounded-3xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)] text-slate-100 h-full">
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="text-lg font-semibold text-white">Transfer funds</h3>
          <p className="text-sm text-slate-300">Send USDC</p>
        </div>

        <div className="relative">
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-white/70 pointer-events-none">
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amountInput}
            className="text-3xl font-bold text-white bg-transparent border-none outline-none w-full pl-8"
            placeholder="0.00"
            onChange={(e) => {
              const value = e.target.value;
              setAmountInput(value);
              if (value === "") {
                setAmount(null);
                return;
              }
              const numValue = parseFloat(value);
              if (!isNaN(numValue)) {
                setAmount(numValue);
              }
            }}
            style={{ fontFamily: "inherit" }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-slate-300">Transfer to</label>
          <input
            type="text"
            value={recipient || ""}
            className="w-full px-3 py-2 border border-white/20 rounded-2xl bg-white/5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#ffac44] focus:border-transparent transition"
            placeholder="Enter wallet address"
            onChange={(e) => setRecipient(e.target.value || null)}
          />
        </div>

        {error ? <p className="text-xs text-rose-200">{error}</p> : null}

        <button
          className={cn(
            "w-full py-3 px-4 rounded-full text-sm font-semibold transition-all duration-200",
            isLoading || !recipient || !amount
              ? "bg-white/30 text-white/60 cursor-not-allowed"
              : "bg-gradient-to-r from-[#ffac44] to-[#ff7a18] text-[#041126] hover:opacity-90"
          )}
          onClick={handleTransfer}
          disabled={isLoading || !recipient || !amount}
        >
          {isLoading ? "Transferring..." : "Transfer"}
        </button>

        {statusMessage ? (
          <p className="text-xs text-white/60 text-center">{statusMessage}</p>
        ) : null}

        {explorerLink && !isLoading ? (
          <a
            href={explorerLink}
            className="text-sm text-orange-200 hover:text-orange-100 text-center transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            → View transaction on explorer
          </a>
        ) : null}
      </div>

      <TransferOtpModal
        open={otpOpen}
        step={otpStep}
        email={otpEmail}
        code={otpCode}
        resendSeconds={otpResendSeconds}
        isSubmitting={otpIsSubmitting}
        error={otpError}
        onClose={() => {
          setOtpOpen(false);
          setOtpPendingTransfer(false);
          setOtpError(null);
        }}
        onSendCode={handleSendOtp}
        onCodeChange={setOtpCode}
        onVerify={handleVerifyOtp}
        onResend={handleResendOtp}
      />
    </div>
  );
}
