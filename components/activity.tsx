import { useEffect, useMemo, useState } from "react";
import { type Activity, useWallet } from "@crossmint/client-sdk-react-ui";
import Image from "next/image";
import { cn } from "@/lib/utils";

export function Activity() {
  const { wallet } = useWallet();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
  const tokenSymbolsByMint = useMemo<Record<string, string>>(
    () => ({
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
    }),
    []
  );

  useEffect(() => {
    if (!wallet) return;

    const fetchActivity = async () => {
      try {
        const activity = await wallet.experimental_activity();
        const filteredActivity = activity.events.filter((event) => {
          const mintHash = event.mint_hash ?? "";
          const symbol =
            tokenSymbolsByMint[mintHash] ?? event.token_symbol?.toUpperCase();
          return symbol?.startsWith("USDXM") || symbol === "USDC";
        });
        setActivity({ events: filteredActivity });
      } catch (error) {
        console.error("Failed to fetch activity:", error);
      } finally {
        setHasInitiallyLoaded(true);
      }
    };

    fetchActivity();
    // Poll every 5 seconds
    const interval = setInterval(() => {
      fetchActivity();
    }, 5000);
    return () => clearInterval(interval);
  }, [tokenSymbolsByMint, wallet]);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(
      timestamp < 10000000000 ? timestamp * 1000 : timestamp
    );
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    if (diffInMs < 0) {
      return "just now";
    }
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 1) {
      return "just now";
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    } else {
      return `${diffInDays}d ago`;
    }
  };

  return (
    <div className="bg-[#1c2c56] border border-white/15 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.35)] p-6 text-slate-100">
      <div className="flex flex-col h-full gap-4">
        <h3 className="text-lg font-semibold text-white">Activity</h3>

        {!hasInitiallyLoaded ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm text-slate-400">Loading activity...</div>
          </div>
        ) : activity?.events && activity.events.length > 0 ? (
          <div className="flex-1 overflow-hidden">
            <div className="max-h-[378px] overflow-y-auto space-y-3">
              {activity.events.map((event, index) => {
                const isIncoming =
                  event.to_address.toLowerCase() ===
                  wallet?.address.toLowerCase();
                const tokenSymbol =
                  tokenSymbolsByMint[event.mint_hash ?? ""] ??
                  event.token_symbol ??
                  "UNKNOWN";
                return (
                  <div
                    key={event.transaction_hash}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-2xl transition-all duration-200",
                      index % 2 === 0 ? "bg-white/5" : "bg-orange-500/5"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center",
                          isIncoming
                            ? "bg-white/20 text-orange-100"
                            : "bg-white/15 text-slate-200"
                        )}
                      >
                        <Image
                          src={
                            isIncoming
                              ? "/arrow-down.svg"
                              : "/arrow-up-right.svg"
                          }
                          alt={isIncoming ? "arrow-down" : "arrow-up-right"}
                          className={cn(
                            isIncoming ? "filter-blue" : "filter-green"
                          )}
                          width={18}
                          height={18}
                        />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">
                            {isIncoming ? "Received" : "Sent"}
                          </span>
                          <span className="text-xs text-slate-400">
                            {formatTimestamp(event.timestamp)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-300 font-mono">
                          {isIncoming
                            ? `From ${formatAddress(event.from_address)}`
                            : `To ${formatAddress(event.to_address)}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div
                          className={cn(
                            "text-sm font-semibold tracking-wide",
                            isIncoming ? "text-orange-200" : "text-slate-200"
                          )}
                        >
                          {isIncoming ? "+" : "-"}${event.amount}
                        </div>
                        <div className="text-xs text-slate-400">
                          {tokenSymbol}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-3">
            <h4 className="font-medium text-white">Your activity feed</h4>
            <p className="text-sm text-slate-400">
              When you add and send money it shows up here. Get started by
              topping up your balance.
            </p>
            <button
              onClick={() => {
                const fundButton = document.querySelector("[data-fund-button]");
                if (fundButton instanceof HTMLElement) {
                  fundButton.click();
                }
              }}
              className="px-6 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-[#ffac44] to-[#ff7a18] text-[#041126] shadow-lg transition hover:opacity-90"
            >
              Add money
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
