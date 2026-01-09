"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { LogoutButton } from "./logout";
import { Footer } from "./footer";
import { OnrampCheckout } from "@/components/onramp-checkout";
import { EmailTransferFunds } from "@/components/email-transfer";
import { AgentChatWidget } from "@/components/agent-chat-widget";

type EmailWallet = {
  address?: string;
  owner?: string;
  chain?: string;
  chainType?: string;
  type?: string;
  locator?: string;
  id?: string;
};

type EmailDashboardProps = {
  emailWallet?: EmailWallet | null;
  emailWalletError?: string | null;
  emailAddress?: string;
  isEmailWalletLoading?: boolean;
  onEmailLogout?: () => void;
};

export function EmailDashboard({
  emailWallet,
  emailWalletError,
  emailAddress,
  isEmailWalletLoading,
  onEmailLogout,
}: EmailDashboardProps) {
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [isOnrampOpen, setIsOnrampOpen] = useState(false);
  const [activity, setActivity] = useState<Array<Record<string, any>>>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const lastBalanceRef = useRef<string | null>(null);
  const lastActivityHashRef = useRef<string>("");
  const hasLoadedBalanceRef = useRef(false);
  const hasLoadedActivityRef = useRef(false);
  const balanceErrorRef = useRef<string | null>(null);
  const activityErrorRef = useRef<string | null>(null);
  const formatWalletAddress = (address: string) => {
    if (!address) return "Unknown";
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };
  const formatRelativeTime = (value?: string) => {
    if (!value) return "Recent";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recent";
    const diffMs = Date.now() - date.getTime();
    if (diffMs <= 0) return "Recent";
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return "Earlier";
  };
  const formatTimestamp = (value?: string) => {
    if (!value) return "Unknown time";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return date.toLocaleString();
  };

  const walletAddress = emailWallet?.address ?? "";
  const ownerLabel = useMemo(() => {
    if (emailWallet?.owner) {
      return emailWallet.owner.replace(/^[^:]*:/, "");
    }
    if (emailWallet?.locator) {
      return emailWallet.locator.replace(/^[^:]*:/, "");
    }
    if (emailAddress) {
      return emailAddress;
    }
    return "Current User";
  }, [emailAddress, emailWallet?.locator, emailWallet?.owner]);

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    if (typeof navigator === "undefined" || !navigator?.clipboard?.writeText) {
      console.error("Clipboard API not available");
      return;
    }
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const fetchBalance = useCallback(async () => {
    if (!walletAddress) return;
    const shouldShowLoading = !hasLoadedBalanceRef.current;
    if (shouldShowLoading) {
      setIsLoadingBalance(true);
    }
    try {
      const res = await fetch(
        `/api/auth/email/balance?walletLocator=${encodeURIComponent(
          walletAddress
        )}&tokens=USDC`
      );
      const data = await res.json();
      if (!res.ok) {
        const errorMessage =
          data?.error || "Failed to fetch balance from Crossmint.";
        if (balanceErrorRef.current !== errorMessage) {
          setBalanceError(errorMessage);
          balanceErrorRef.current = errorMessage;
        }
        return;
      }
      const tokenList = Array.isArray(data)
        ? data
        : Array.isArray(data?.tokens)
          ? data.tokens
          : [];
      const tokenEntry = tokenList.find(
        (token: any) => String(token?.symbol ?? "").toLowerCase() === "usdc"
      );
      const amount =
        tokenEntry?.amount ??
        data?.usdc?.amount ??
        data?.balances?.usdc?.amount ??
        "0";
      const nextBalance = String(amount);
      if (lastBalanceRef.current !== nextBalance) {
        setBalance(nextBalance);
        lastBalanceRef.current = nextBalance;
      }
      if (balanceErrorRef.current !== null) {
        setBalanceError(null);
        balanceErrorRef.current = null;
      }
    } catch (error) {
      const errorMessage = "Failed to fetch balance from Crossmint.";
      if (balanceErrorRef.current !== errorMessage) {
        setBalanceError(errorMessage);
        balanceErrorRef.current = errorMessage;
      }
    } finally {
      if (shouldShowLoading) {
        setIsLoadingBalance(false);
      }
      hasLoadedBalanceRef.current = true;
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    fetchBalance();
  }, [fetchBalance, walletAddress]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleRefresh = () => {
      fetchBalance();
    };
    window.addEventListener("wallet:refresh-balance", handleRefresh);
    return () => {
      window.removeEventListener("wallet:refresh-balance", handleRefresh);
    };
  }, [fetchBalance]);

  const handleTopUp = () => {
    if (!walletAddress) {
      alert("Wallet address not available yet. Please try again.");
      return;
    }
    setIsOnrampOpen(true);
  };

  const fetchActivity = useCallback(async () => {
    if (!walletAddress) return;
    const shouldShowLoading = !hasLoadedActivityRef.current;
    if (shouldShowLoading) {
      setIsLoadingActivity(true);
    }
    try {
      const res = await fetch(
        `/api/auth/email/activity?walletLocator=${encodeURIComponent(
          walletAddress
        )}&sort=desc&chain=solana&tokens=USDC&status=successful`
      );
      const data = await res.json();
      if (!res.ok) {
        const errorMessage =
          data?.error || "Failed to fetch activity from Crossmint.";
        if (activityErrorRef.current !== errorMessage) {
          setActivityError(errorMessage);
          activityErrorRef.current = errorMessage;
        }
        return;
      }
      const events = Array.isArray(data?.transfers)
        ? data.transfers
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
      const nextHash = JSON.stringify(events);
      if (nextHash !== lastActivityHashRef.current) {
        setActivity(events);
        lastActivityHashRef.current = nextHash;
      }
      if (activityErrorRef.current !== null) {
        setActivityError(null);
        activityErrorRef.current = null;
      }
    } catch (error) {
      const errorMessage = "Failed to fetch activity from Crossmint.";
      if (activityErrorRef.current !== errorMessage) {
        setActivityError(errorMessage);
        activityErrorRef.current = errorMessage;
      }
    } finally {
      if (shouldShowLoading) {
        setIsLoadingActivity(false);
      }
      hasLoadedActivityRef.current = true;
    }

  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    const runPoll = () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      fetchActivity();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh-balance"));
      }
    };
    runPoll();
    const interval = window.setInterval(runPoll, 10000);
    const handleVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        runPoll();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
    return () => {
      window.clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [fetchActivity, walletAddress]);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full max-w-6xl mx-auto px-4 py-10 flex flex-col gap-8">
        {emailWalletError ? (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-rose-400 text-xs font-semibold text-rose-500">
              !
            </span>
            <span>{emailWalletError}</span>
          </div>
        ) : null}

        <section
          className="rounded-[32px] overflow-hidden shadow-[0_30px_80px_rgba(5,12,41,0.15)]"
          style={{
            backgroundImage: "url('/dashboard-wallet-security.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="flex flex-col gap-4 px-6 py-10 backdrop-brightness-75">
            <p className="text-xs uppercase tracking-[0.4em] text-white/70">
              Finyx WAAS
            </p>
            <h2 className="text-1.8xl font-semibold text-white sm:text-1.8xl">
              <span className="inline-flex items-center gap-1">
                <Image
                  src="/bitcoin-icon.svg"
                  width={30}
                  height={30}
                  alt="Bitcoin icon"
                  className="h-8 w-8"
                />
                <span>uilt for fast payouts and compliant flows</span>
              </span>
            </h2>
            <p className="max-w-3xl text-sm text-white/80">
             
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Dashboard</h2>
              <p className="text-sm text-slate-500">
                Wallet overview and instant actions
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/finyx/402"
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-[#041126] bg-white/90 border border-white/60 shadow-lg transition hover:bg-white"
              >
                402 Demo
              </Link>
              <LogoutButton hasEmailSession onEmailLogout={onEmailLogout} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="flex flex-col gap-6">
              <div className="bg-[#27395d] border border-white/15 p-6 rounded-3xl shadow-lg">
                <div className="flex flex-col gap-2 text-white">
                  <h3 className="text-lg font-semibold">Balance</h3>
                  {balanceError ? (
                    <p className="text-sm text-rose-200">{balanceError}</p>
                  ) : isLoadingBalance ? (
                    <p className="text-sm text-slate-300">Loading balance...</p>
                  ) : (
                    <div className="flex items-end gap-2">
                      <span className="text-3xl font-bold">$</span>
                      <span className="text-3xl font-bold tabular-nums">
                        {balance ? Number(balance).toFixed(2) : "0.00"}
                      </span>
                      <span className="text-2xl font-semibold text-white/80">
                        USDC
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleTopUp}
                      data-fund-button
                      className="min-w-[72px] rounded-full px-3 py-2 text-center text-xs font-semibold transition-all duration-200 bg-gradient-to-r from-[#ffac44] to-[#ff7a18] text-[#041126] shadow-lg"
                    >
                      Top up
                    </button>
                  </div>
                </div>
              </div>
              <div className="bg-[#27395d] border border-white/15 p-6 rounded-3xl shadow-lg space-y-4">
                <h3 className="text-lg font-semibold text-white">Wallet details</h3>
                <div className="flex flex-col gap-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Address</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-100">
                        {isEmailWalletLoading
                          ? "Loading..."
                          : walletAddress
                          ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-6)}`
                          : "Not connected"}
                      </span>
                      <button
                        onClick={handleCopyAddress}
                        disabled={!walletAddress}
                        className="text-slate-300 hover:text-white transition"
                      >
                        {copiedAddress ? (
                          <Image
                            src="/circle-check-big.svg"
                            alt="Copied"
                            width={16}
                            height={16}
                          />
                        ) : (
                          <Image src="/copy.svg" alt="Copy" width={16} height={16} />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Owner</span>
                    <span className="text-slate-100">{ownerLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Chain</span>
                    <span className="text-slate-100 capitalize">
                      {emailWallet?.chain ?? emailWallet?.chainType ?? "Unknown"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="lg:col-span-1 flex h-full flex-col">
              <EmailTransferFunds
                walletAddress={walletAddress}
                onTransferSuccess={() => {
                  fetchActivity();
                  fetchBalance();
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new Event("wallet:refresh-balance"));
                  }
                }}
              />
            </div>
            <div className="lg:col-span-1 flex h-full flex-col">
              <div className="bg-[#27395d] border border-white/15 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.35)] p-6 text-slate-100 h-full">
                <div className="flex flex-col h-full gap-4">
                  <h3 className="text-lg font-semibold text-white">Activity</h3>
                  {activityError ? (
                    <p className="text-sm text-rose-200">{activityError}</p>
                  ) : isLoadingActivity ? (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-sm text-slate-300">Loading activity...</p>
                    </div>
                  ) : activity.length > 0 ? (
                    <div className="flex-1 overflow-hidden">
                      <div className="max-h-[277px] overflow-y-auto space-y-3">
                        {activity.map((item, index) => {
                          const amount = item?.token?.amount ?? "0";
                          const amountNumber = Number(amount);
                          const amountText = Number.isFinite(amountNumber)
                            ? amountNumber.toLocaleString(undefined, {
                                maximumFractionDigits: 6,
                              })
                            : String(amount);
                          const isOut = item?.type === "wallets.transfer.out";
                          const direction = isOut ? "Sent" : "Received";
                          const timestamp = formatRelativeTime(item?.completedAt);
                          const occurredAt = formatTimestamp(item?.completedAt);
                          const txId = item?.onChain?.txId ?? "";
                          const counterparty = isOut
                            ? item?.recipient?.address
                            : item?.sender?.address;
                          const label = isOut ? "To" : "From";
                          const symbol = "USDC";
                          const explorerLink =
                            item?.onChain?.explorerLink ||
                            (txId
                              ? `https://explorer.solana.com/tx/${txId}?cluster=devnet`
                              : "");
                          return (
                            <div
                              key={txId || index}
                              className={`flex items-center justify-between p-3 rounded-2xl ${
                                index % 2 === 0 ? "bg-white/5" : "bg-orange-500/5"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-9 h-9 rounded-full flex items-center justify-center ${
                                    isOut ? "bg-white/15 text-slate-200" : "bg-white/20 text-orange-100"
                                  }`}
                                >
                                  <Image
                                    src={isOut ? "/arrow-up-right.svg" : "/arrow-down.svg"}
                                    alt={direction}
                                    className={isOut ? "filter-green" : "filter-blue"}
                                    width={18}
                                    height={18}
                                  />
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-white">
                                      {direction}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                      {timestamp}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {occurredAt}
                                  </div>
                                  <div className="text-xs text-slate-300 font-mono">
                                    {label} {formatWalletAddress(counterparty ?? "")}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  {explorerLink ? (
                                    <a
                                      href={explorerLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`text-sm font-semibold tracking-wide underline underline-offset-2 transition-colors hover:opacity-80 ${
                                        isOut ? "text-slate-200" : "text-orange-200"
                                      }`}
                                    >
                                      {isOut ? "-" : "+"}${amountText}
                                    </a>
                                  ) : (
                                    <div
                                      className={`text-sm font-semibold ${
                                        isOut ? "text-slate-200" : "text-orange-200"
                                      }`}
                                    >
                                      {isOut ? "-" : "+"}${amountText}
                                    </div>
                                  )}
                                  <div className="text-xs text-slate-400">{symbol}</div>
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
                        When you add and send money it shows up here.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <Footer />
      <AgentChatWidget />
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
              walletAddress={walletAddress}
              receiptEmail={emailAddress ?? ""}
              onPaymentSuccess={() => {
                fetchBalance();
                setTimeout(() => {
                  fetchBalance();
                }, 3000);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
