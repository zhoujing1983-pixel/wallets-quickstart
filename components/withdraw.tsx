"use client";

import { useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { cn } from "@/lib/utils";

type WithdrawModalProps = {
  open: boolean;
  bankAccountRef: string;
  onClose: () => void;
  onSuccess?: () => void;
};

export function WithdrawModal({
  open,
  bankAccountRef,
  onClose,
  onSuccess,
}: WithdrawModalProps) {
  const { wallet } = useWallet();
  const [amountInput, setAmountInput] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) {
    return null;
  }

  const handleWithdraw = async () => {
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (!wallet) {
      setError("Wallet is not ready yet.");
      return;
    }
    if (!bankAccountRef) {
      setError("Bank account reference is not configured.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const txn = await wallet.send(
        `bank:${bankAccountRef}`,
        "usdc",
        amount.toString()
      );
      console.log("Withdraw transaction", txn);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to send money to the bank account.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/60 px-4 py-10 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-sm my-auto">
        <div className="rounded-3xl border border-white/10 bg-[#0b1324] text-white shadow-[0_30px_80px_rgba(3,7,18,0.45)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <div>
              <h1 className="text-base font-semibold">Withdraw USDC</h1>
              <p className="text-[11px] text-white/60">
                Transfer funds to the linked Crossmint bank account.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-[11px] font-semibold text-white/70 hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold text-white/70">$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amountInput}
                onChange={(event) => {
                  setAmountInput(event.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                className="w-full rounded-xl bg-white/10 px-3 py-2 text-base font-semibold text-white outline-none focus:ring-2 focus:ring-[#9df0ff] border border-white/20"
              />
            </div>
            {error ? (
              <p className="text-[11px] text-red-200">{error}</p>
            ) : null}
            <button
              onClick={handleWithdraw}
              disabled={isSubmitting}
              className={cn(
                "w-full py-2 rounded-full text-xs font-semibold transition-all duration-200",
                isSubmitting
                  ? "bg-white/20 text-white/60 cursor-not-allowed"
                  : "bg-gradient-to-r from-[#9df0ff] to-[#5ba0ff] text-[#041126] hover:opacity-90"
              )}
            >
              {isSubmitting ? "Withdrawing..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

