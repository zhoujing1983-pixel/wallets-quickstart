import { useEffect, useMemo, useRef, useState } from "react";
import { type Activity, useWallet } from "@crossmint/client-sdk-react-ui";
import Image from "next/image";
import { cn } from "@/lib/utils";

export function Activity() {
  const { wallet } = useWallet();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
  const lastActivityHash = useRef<string | null>(null);
  type ActivityEvent = Activity["events"][number];
  const tokenSymbolsByMint = useMemo<Record<string, string>>(
    () => ({
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
    }),
    []
  );

  const toSol = (lamports: string) => (Number(lamports) / 1e9).toFixed(9);

  useEffect(() => {
    if (!wallet) return;

    const normalizeTokenSymbol = (tokenLocator?: string) => {
      if (!tokenLocator) return "UNKNOWN";
      const upper = tokenLocator.toUpperCase();
      const locatorSymbol = tokenLocator.includes(":")
        ? tokenLocator.split(":").pop() ?? ""
        : "";
      const locatorUpper = locatorSymbol.toUpperCase();

      if (["USDC", "USDXM", "SOL"].includes(locatorUpper)) {
        return locatorUpper;
      }
      if (
        upper.includes("USDC") ||
        tokenLocator.includes("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU") ||
        tokenLocator.includes("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
      ) {
        return "USDC";
      }
      if (upper.includes("USDXM")) {
        return "USDXM";
      }
      if (upper.includes("SOL")) {
        return "SOL";
      }
      return "UNKNOWN";
    };

    const normalizeTimestamp = (value: unknown) => {
      if (typeof value === "number") {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
          return Math.floor(parsed / 1000);
        }
      }
      return Math.floor(Date.now() / 1000);
    };

    const isActivityEvent = (value: unknown): value is ActivityEvent => {
      if (!value || typeof value !== "object") return false;
      const event = value as ActivityEvent;
      return (
        typeof event.transaction_hash === "string" &&
        typeof event.to_address === "string" &&
        typeof event.from_address === "string" &&
        typeof event.amount === "string" &&
        typeof event.timestamp === "number" &&
        typeof event.type === "string"
      );
    };

    const extractOutgoingEvents = (
      transactionsResponse: unknown
    ) => {
      if (
        !transactionsResponse ||
        typeof transactionsResponse !== "object" ||
        !("transactions" in transactionsResponse)
      ) {
        return [];
      }
      const transactions = (transactionsResponse as { transactions: any[] })
        .transactions;
      if (!Array.isArray(transactions)) {
        return [];
      }

      return transactions
        .filter((transaction) => transaction?.status === "success")
        .map((transaction) => {
          const txHash =
            transaction?.onChain?.txId ??
            transaction?.onChain?.userOperationHash ??
            transaction?.transactionHash ??
            transaction?.id;
          if (!txHash) {
            return null;
          }

          const sendParams =
            transaction?.sendParams ?? transaction?.params?.sendParams;
          const toAddress =
            sendParams?.params?.recipientAddress ??
            sendParams?.params?.recipient ??
            "";
          const calls = transaction?.params?.calls;
          const firstCall = Array.isArray(calls) ? calls[0] : null;
          const rawValue =
            (firstCall && (firstCall.value ?? firstCall.amount)) || undefined;
          const amount =
            sendParams?.params?.amount ??
            sendParams?.amount ??
            rawValue ??
            "0";
          const tokenLocator =
            sendParams?.token ?? sendParams?.params?.token ?? "";
          const tokenSymbol = normalizeTokenSymbol(tokenLocator);
          if (!["USDC", "SOL"].includes(tokenSymbol)) {
            return null;
          }
          const timestamp = normalizeTimestamp(
            transaction?.updatedAt ?? transaction?.createdAt
          );

          return {
            token_symbol: tokenSymbol,
            transaction_hash: txHash,
            to_address: toAddress || "",
            from_address: wallet.address ?? "",
            timestamp,
            amount: String(amount),
            type: "TRANSFER",
          } as ActivityEvent;
        })
        .filter(isActivityEvent);
    };

    const fetchActivity = async () => {
      try {
        const [activityResponse, transactionsResponse] = await Promise.all([
          wallet.experimental_activity(),
          wallet.experimental_transactions(),
        ]);

        const filteredActivity = activityResponse.events.filter((event) => {
          const mintHash = event.mint_hash ?? "";
          const symbol =
            tokenSymbolsByMint[mintHash] ?? event.token_symbol?.toUpperCase();
          return symbol === "USDC" || symbol === "SOL";
        });

        const outgoingEvents = extractOutgoingEvents(transactionsResponse);
        const mergedByHash = new Map<string, ActivityEvent>();
        for (const event of filteredActivity) {
          mergedByHash.set(event.transaction_hash, event);
        }
        for (const event of outgoingEvents) {
          mergedByHash.set(event.transaction_hash, event);
        }
        const mergedEvents = Array.from(mergedByHash.values()).sort(
          (a, b) => b.timestamp - a.timestamp
        );

        setActivity({ events: mergedEvents });
        const currentHash = mergedEvents
          .map((event) => event.transaction_hash)
          .join("|");

          console.log("has changed?????", lastActivityHash.current=== currentHash);
       

        if (lastActivityHash.current !== currentHash) {
          console.log("Activity has changed, dispatching event");
         
          // if (typeof window !== "undefined") {
          //   console.log("Dispatching wallet:refresh-balance event");
          //   window.dispatchEvent(new Event("wallet:refresh-balance"));
          // }
           lastActivityHash.current = currentHash;
        }
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
       if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("wallet:refresh-balance"));
          }
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
    <div className="bg-[#27395d] border border-white/15 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.35)] p-6 text-slate-100">
      <div className="flex flex-col h-full gap-4">
        <h3 className="text-lg font-semibold text-white">Activity</h3>

        {!hasInitiallyLoaded ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm text-slate-400">Loading activity...</div>
          </div>
        ) : activity?.events && activity.events.length > 0 ? (
          <div className="flex-1 overflow-hidden">
            <div className="max-h-[277px] overflow-y-auto space-y-3">
              {activity.events.map((event, index) => {
                const isIncoming =
                  event.to_address.toLowerCase() ===
                  wallet?.address.toLowerCase();
                const tokenSymbol =
                  tokenSymbolsByMint[event.mint_hash ?? ""] ??
                  event.token_symbol ??
                  "UNKNOWN";
                const displayAmount =
                  tokenSymbol === "SOL"
                    ? toSol(event.amount)
                    : event.amount;
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
                        <a
                          href={`https://explorer.solana.com/tx/${event.transaction_hash}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "text-sm font-semibold tracking-wide underline underline-offset-2 transition-colors hover:opacity-80",
                            isIncoming ? "text-orange-200" : "text-slate-200"
                          )}
                        >
                          {isIncoming ? "+" : "-"}${displayAmount}
                        </a>
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
