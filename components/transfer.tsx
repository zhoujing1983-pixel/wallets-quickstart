"use client";

import { useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { cn } from "@/lib/utils";

export function TransferFunds() {
  const { wallet } = useWallet();
  const [recipient, setRecipient] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountInput, setAmountInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [explorerLink, setExplorerLink] = useState<string | null>(null);

  async function handleOnTransfer() {
    if (wallet == null || recipient == null || amount == null) {
      alert("Transfer: missing required fields");
      return;
    }

    try {
      setIsLoading(true);
      const txn = await wallet.send(recipient, "usdxm", amount.toString());
      setExplorerLink(txn.explorerLink);
    } catch (err) {
      console.error("Transfer: ", err);
      if (err instanceof Error && err.name === "AuthRejectedError") {
        return;
      } else {
        alert("Transfer: " + err);
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="bg-[#0a1530] border border-white/10 rounded-3xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)] text-slate-100">
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="text-lg font-semibold text-white">Transfer funds</h3>
          <p className="text-sm text-slate-300">Send USDXM or native tokens</p>
        </div>

        {/* Amount Input */}
        <div className="relative">
          <span className="absolute left-0 top-1 text-4xl font-bold text-white/70 pointer-events-none">
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amountInput}
            className="text-4xl font-bold text-white bg-transparent border-none outline-none w-full pl-8"
            placeholder="0.00"
            onChange={(e) => {
              const value = e.target.value;
              setAmountInput(value);

              if (value === "") {
                setAmount(null);
              } else {
                const numValue = parseFloat(value);
                if (!isNaN(numValue)) {
                  setAmount(numValue);
                }
              }
            }}
            style={{
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Transfer To Input */}
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

        {/* Transfer Button */}
        <button
          className={cn(
            "w-full py-3 px-4 rounded-full text-sm font-semibold transition-all duration-200",
            isLoading || !recipient || !amount
              ? "bg-white/30 text-white/60 cursor-not-allowed"
              : "bg-gradient-to-r from-[#ffac44] to-[#ff7a18] text-[#041126] hover:opacity-90"
          )}
          onClick={handleOnTransfer}
          disabled={isLoading || !recipient || !amount}
        >
          {isLoading ? "Transferring..." : "Transfer"}
        </button>

        {/* Explorer Link */}
        {explorerLink && !isLoading && (
          <a
            href={explorerLink}
            className="text-sm text-orange-200 hover:text-orange-100 text-center transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            → View transaction on explorer
          </a>
        )}
      </div>
    </div>
  );
}
