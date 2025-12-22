"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Balances, useWallet, useAuth } from "@crossmint/client-sdk-react-ui";
import { cn } from "@/lib/utils";
import { OnrampCheckout } from "@/components/onramp-checkout";

export function WalletBalance() {
  const { wallet } = useWallet();
  const { user } = useAuth();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [isOnrampOpen, setIsOnrampOpen] = useState(false);

  const refreshBalances = useCallback(async () => {
    if (!wallet) return;
    try {
      const balances = await wallet.balances(["usdxm"]);
      setBalances(balances);
    } catch (error) {
      console.warn("Error fetching wallet balances:", error);
    }
  }, [wallet]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    if (!isOnrampOpen || !wallet) {
      return;
    }
    const intervalId = window.setInterval(() => {
      refreshBalances();
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOnrampOpen, refreshBalances, wallet]);

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

  return (
    <div className="flex flex-col gap-4 text-white">
      {/* Header with Icon and Info */}
      <div className="flex items-center gap-3">
        <Image src="/usdxm.svg" alt="USDXM" width={24} height={24} />
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
      <div className="text-4xl font-bold flex items-end gap-2">
        <span>${usdxmBalance}</span>
        <span className="text-xl font-semibold tracking-wide">USDXM</span>
      </div>
      <div className="text-4xl font-bold flex items-end gap-2">
        <span>${usdcBalance}</span>
        <span className="text-xl font-semibold tracking-wide">USDC</span>
      </div>

      {/* Add Money Button */}
      <div className="flex flex-col gap-3">
        <button
          onClick={handleFund}
          data-fund-button
          className={cn(
            "w-full py-3 px-4 rounded-full text-sm font-semibold transition-all duration-200",
            "bg-gradient-to-r from-[#ffac44] to-[#ff7a18] text-[#041126] shadow-lg"
          )}
        >
          Add money
        </button>
        <p className="text-xs text-slate-300 text-center">
          Refresh the page after transferring. Balance may take a few seconds to
          update.
        </p>
      </div>

      {isOnrampOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-center bg-black/60 px-4 py-10 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-xl my-auto">
            <button
              onClick={() => setIsOnrampOpen(false)}
              className="absolute -top-10 right-0 text-xs font-semibold text-white/70 hover:text-white"
            >
              Close
            </button>
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
    </div>
  );
}
