"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Balances, useWallet, useAuth } from "@crossmint/client-sdk-react-ui";
import { cn } from "@/lib/utils";
import { OnrampCheckout } from "@/components/onramp-checkout";
import { WithdrawModal } from "@/components/withdraw";

export function WalletBalance() {
  const { wallet } = useWallet();
  const { user } = useAuth();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [isOnrampOpen, setIsOnrampOpen] = useState(false);
  const [isUsdxmFunding, setIsUsdxmFunding] = useState(false);
  const [isUsdxmModalOpen, setIsUsdxmModalOpen] = useState(false);
  const [usdxmAmountInput, setUsdxmAmountInput] = useState("10");
  const [usdxmAmountError, setUsdxmAmountError] = useState<string | null>(null);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const bankAccountRef =
    process.env.NEXT_PUBLIC_CROSSMINT_BANK_ACCOUNT_REF ?? "";

  const refreshBalances = useCallback(async () => {
    console.log("refreshing wallet balances");
    if (!wallet) {
      console.warn("Wallet not available yet");
      return;
    }
    try {
    const balances = await wallet.balances(["usdxm"]);
      console.log("fetched wallet balances:", balances);
      setBalances(balances);
    } catch (error) {
      console.warn("Error fetching wallet balances:", error);
    }
  }, [wallet]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    console.log("received event:", wallet?.address);
    const handleRefresh = () => {
      refreshBalances();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("wallet:refresh-balance", handleRefresh);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("wallet:refresh-balance", handleRefresh);
      }
    };
  }, [refreshBalances]);



  const formatBalance = (balance: string) => {
    return Number(balance).toFixed(2);
  };

  const usdxmToken = balances?.tokens.find((token) => token.symbol === "usdxm");
  const usdxmBalance = formatBalance(usdxmToken?.amount || "0");
  const usdcBalance  = formatBalance(balances?.usdc?.amount ?? "0");


  const handleFund = () => {
    if (!wallet?.address) {
      alert("Wallet address not available yet. Please try again.");
      return;
    }
    setIsOnrampOpen(true);
  };

  const handleWithdraw = () => {
    setIsWithdrawModalOpen(true);
  };

 

  const handleUsdxmTopUp = async () => {
    if (!wallet) {
      return;
    }
    const fundingAmount = Number(usdxmAmountInput);
    if (!Number.isFinite(fundingAmount) || fundingAmount <= 0) {
      setUsdxmAmountError("Amount must be greater than 0.");
      return;
    }
    if (fundingAmount > 100) {
      setUsdxmAmountError("Amount must be 100 or less.");
      return;
    }
    setUsdxmAmountError(null);
    setIsUsdxmFunding(true);
    try {
      await wallet.stagingFund(fundingAmount);
      await refreshBalances();
      setIsUsdxmModalOpen(false);
    } catch (error) {
      alert(`Error getting test USDXM: ${error}`);
    } finally {
      setIsUsdxmFunding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 text-white">
      {/* Header with Icon and Info */}
      <div className="flex items-center gap-3">
       
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Balance</h3>
          <div className="relative group">
            <div className="w-5 h-5 rounded-full border border-white/40 flex items-center justify-center cursor-help">
              <span className="text-xs font-medium">i</span>
            </div>
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-white text-[#041126] text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
              USDXM is a Crossmint test stablecoin
              <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Balance Display */}
      
      <div className="flex flex-col gap-2 items-start">
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold">$</span>
          <span className="text-3xl font-bold tabular-nums">{usdcBalance}</span>
          <span className="text-2xl font-semibold text-white/80">USDC</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleFund}
            data-fund-button
            className={cn(
              "min-w-[72px] rounded-full px-3 py-2 text-center text-xs font-semibold transition-all duration-200",
              "bg-gradient-to-r from-[#ffac44] to-[#ff7a18] text-[#041126] shadow-lg"
            )}
          >
            Top up
          </button>
          <button
            onClick={handleWithdraw}
            className={cn(
              "min-w-[72px] rounded-full px-3 py-2 text-center text-xs font-semibold transition-all duration-200",
              "bg-gradient-to-r from-[#ffffff] to-[#d0d2ff] text-[#041126] shadow-lg"
            )}
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* Helper Text */}
      {/* <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-300 text-center">
          Balance may take a few seconds to update.
        </p>
      </div> */}

      {isOnrampOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-center bg-black/60 px-4 py-10 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-xl my-auto">
            <OnrampCheckout
              onClose={() => setIsOnrampOpen(false)}
              showReturnLink={false}
              walletAddress={wallet?.address ?? ""}
              receiptEmail={user?.email ?? ""}
              onPaymentSuccess={() => {
                refreshBalances();
                setTimeout(() => {
                  refreshBalances();
                }, 3000);
              }}
            />
          </div>
        </div>
      ) : null}

      {isUsdxmModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-center bg-black/60 px-4 py-10 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-sm my-auto">
            <div className="rounded-3xl border border-white/10 bg-[#0b1324] text-white shadow-[0_30px_80px_rgba(3,7,18,0.45)] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
                <div>
                  <h1 className="text-base font-semibold">Top up USDXM</h1>
                  <p className="text-[11px] text-white/60">
                    Enter the amount to mint.
                  </p>
                </div>
                <button
                  onClick={() => setIsUsdxmModalOpen(false)}
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
                    min="1"
                    step="1"
                    value={usdxmAmountInput}
                    onChange={(event) => {
                      setUsdxmAmountInput(event.target.value);
                      setUsdxmAmountError(null);
                    }}
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-base font-semibold text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                </div>
                {usdxmAmountError ? (
                  <p className="text-[11px] text-red-200">
                    {usdxmAmountError}
                  </p>
                ) : null}
                <button
                  onClick={handleUsdxmTopUp}
                  disabled={isUsdxmFunding}
                  className={cn(
                    "w-full py-2 rounded-full text-xs font-semibold transition-all duration-200",
                    isUsdxmFunding
                      ? "bg-white/20 text-white/60 cursor-not-allowed"
                      : "bg-white text-[#041126] hover:opacity-90"
                  )}
                >
                  {isUsdxmFunding ? "Topping up..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <WithdrawModal
        open={isWithdrawModalOpen}
        bankAccountRef={bankAccountRef}
        onClose={() => setIsWithdrawModalOpen(false)}
        onSuccess={() => {
          refreshBalances();
        }}
      />
    </div>
  );
}
