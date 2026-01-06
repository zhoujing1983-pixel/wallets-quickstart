"use client";

import { useCallback, useRef, useState } from "react";
import { EmailSignersDialog, useCrossmintAuth } from "@crossmint/client-sdk-react-ui";
import { cn } from "@/lib/utils";
import {
  getSignerStatus,
  sendEmailOtp,
  signSolanaTransaction,
  verifyEmailOtp,
} from "@/lib/crossmint-email-signer";

type EmailTransferFundsProps = {
  walletAddress: string;
  email?: string;
  onTransferSuccess?: () => void;
};

export function EmailTransferFunds({
  walletAddress,
  email,
  onTransferSuccess,
}: EmailTransferFundsProps) {
  const [recipient, setRecipient] = useState<string>("");
  const [amount, setAmount] = useState<number | null>(null);
  const [amountInput, setAmountInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explorerLink, setExplorerLink] = useState<string | null>(null);
  const [isOtpOpen, setIsOtpOpen] = useState(false);
  const [otpStep, setOtpStep] = useState<"initial" | "otp">("initial");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const { jwt } = useCrossmintAuth();
  const pendingApprovalRef = useRef<{
    transactionId: string;
    transactionToSign: string;
    signer: string;
  } | null>(null);
  const rejectRef = useRef<((error: Error) => void) | undefined>(undefined);

  const canSubmit =
    Boolean(walletAddress) && Boolean(recipient) && amount != null;
  const clientApiKey =
    process.env.NEXT_PUBLIC_CROSSMINT_CLIENT_API_KEY ??
    process.env.NEXT_PUBLIC_FINYX_API_KEY ??
    "";
  const signerEnv = process.env.NEXT_PUBLIC_CROSSMINT_ENV ?? "staging";

  const signAndApprove = useCallback(async () => {
    const pendingApproval = pendingApprovalRef.current;
    if (!pendingApproval) {
      setError("Transfer approval payload is missing.");
      return;
    }
    setIsLoading(true);
    setStatusMessage("Signing transaction...");
    try {
    const signature = await signSolanaTransaction({
      apiKey: clientApiKey,
      jwt: jwt ?? "",
      environment: signerEnv,
      transaction: pendingApproval.transactionToSign,
    });
      const approvalRes = await fetch("/api/auth/email/transfer/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletLocator: walletAddress,
          transactionId: pendingApproval.transactionId,
          signer: pendingApproval.signer,
          signature,
        }),
      });
      const approvalData = await approvalRes.json();
      if (!approvalRes.ok) {
        const message =
          approvalData?.details?.message ||
          approvalData?.details?.error ||
          approvalData?.error ||
          "Failed to approve transfer";
        setError(message);
        return;
      }
      const approvedTransaction = approvalData?.transaction ?? approvalData;
      const explorer =
        approvedTransaction?.onChain?.explorerLink ??
        approvedTransaction?.hash ??
        null;
      if (explorer) {
        setExplorerLink(explorer);
      }
      onTransferSuccess?.();
    } finally {
      setIsLoading(false);
      setStatusMessage(null);
    }
  }, [clientApiKey, onTransferSuccess, signerEnv, walletAddress]);

  const handleTransfer = async () => {
    if (!canSubmit) {
      alert("Transfer: missing required fields");
      return;
    }
    if (!email) {
      setError("Email is required for OTP approval.");
      return;
    }
    if (!clientApiKey) {
      setError("Missing client API key.");
      return;
    }
    if (!jwt) {
      setError("Crossmint auth is required to approve this transfer.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setExplorerLink(null);
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
      const approvalSigner =
        transaction?.approvals?.pending?.[0]?.signer?.locator ??
        data?.approvals?.pending?.[0]?.signer?.locator ??
        `email:${email}`;
      const transactionToSign =
        transaction?.onChain?.transaction ??
        data?.onChain?.transaction ??
        transaction?.params?.transaction ??
        data?.params?.transaction ??
        null;
      if (!transactionId || !transactionToSign) {
        setError("Transfer approval payload is missing.");
        return;
      }
      pendingApprovalRef.current = {
        transactionId,
        transactionToSign,
        signer: approvalSigner,
      };

      let signerStatus: "ready" | "new-device" = "new-device";
      try {
        signerStatus = await getSignerStatus({
          apiKey: clientApiKey,
          jwt,
          environment: signerEnv,
        });
      } catch (statusError) {
        signerStatus = "new-device";
      }
      if (signerStatus === "ready") {
        await signAndApprove();
        return;
      }

      setStatusMessage("Waiting for OTP...");
      setOtpStep("initial");
      setIsOtpOpen(true);
    } catch (err) {
      setError("Failed to transfer funds.");
    } finally {
      if (!isOtpOpen) {
        setIsLoading(false);
      }
    }
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
              if (!Number.isNaN(numValue)) {
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
            value={recipient}
            className="w-full px-3 py-2 border border-white/20 rounded-2xl bg-white/5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#ffac44] focus:border-transparent transition"
            placeholder="Enter wallet address"
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>

        {error ? <p className="text-xs text-rose-200">{error}</p> : null}

        <button
          className={cn(
            "w-full py-3 px-4 rounded-full text-sm font-semibold transition-all duration-200",
            isLoading || !canSubmit
              ? "bg-white/30 text-white/60 cursor-not-allowed"
              : "bg-gradient-to-r from-[#ffac44] to-[#ff7a18] text-[#041126] hover:opacity-90"
          )}
          onClick={handleTransfer}
          disabled={isLoading || !canSubmit}
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
      <EmailSignersDialog
        email={email}
        open={isOtpOpen}
        setOpen={(open) => {
          setIsOtpOpen(open);
          if (!open) {
            rejectRef.current?.(new Error("OTP dialog closed"));
            setIsLoading(false);
            setStatusMessage(null);
          }
        }}
        step={otpStep}
        onSubmitEmail={async () => {
          try {
            const status = await sendEmailOtp({
              apiKey: clientApiKey,
              jwt,
              email,
              environment: signerEnv,
            });
            if (status === "ready") {
              setIsOtpOpen(false);
              await signAndApprove();
              return;
            }
            setStatusMessage("Waiting for OTP...");
            setOtpStep("otp");
          } catch (otpError) {
            setError("Failed to send OTP.");
          }
        }}
        onResendOTPCode={async () => {
          try {
            await sendEmailOtp({
              apiKey: clientApiKey,
              jwt,
              email,
              environment: signerEnv,
            });
          } catch (otpError) {
            setError("Failed to resend OTP.");
          }
        }}
        onSubmitOTP={async (token) => {
          try {
            await verifyEmailOtp({
              apiKey: clientApiKey,
              jwt,
              otp: token,
              environment: signerEnv,
            });
            setIsOtpOpen(false);
            setStatusMessage("Signing transaction...");
            await signAndApprove();
          } catch (otpError) {
            setError("Failed to verify OTP.");
          }
        }}
        rejectRef={rejectRef}
      />
    </div>
  );
}
