"use client";

import { PaymentGate } from "@/components/payment-gate";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import Link from "next/link";
import { useState } from "react";

export default function Demo402Page() {
  const { wallet } = useWallet();
  const [isResettingSession, setIsResettingSession] = useState(false);
  const [amountInput, setAmountInput] = useState("0.01");
  const providerWallet =
    process.env.NEXT_PUBLIC_PROVIDER_WALLET ?? "";

  const resetCrossmintSession = () => {
    if (isResettingSession) {
      return;
    }
    setIsResettingSession(true);
    if (typeof window !== "undefined") {
      const patterns = [/crossmint/i, /wallets/i, /^cm_/i, /finyx/i];
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key && patterns.some((pattern) => pattern.test(key))) {
          localStorage.removeItem(key);
        }
      }
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (key && patterns.some((pattern) => pattern.test(key))) {
          sessionStorage.removeItem(key);
        }
      }
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full max-w-6xl mx-auto px-4 py-10 flex flex-col gap-8">
        <section
          className="rounded-[32px] overflow-hidden shadow-[0_30px_80px_rgba(5,12,41,0.15)]"
          style={{
            backgroundImage: "url('/hero-402.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="px-6 py-10 backdrop-brightness-75">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-white/70">
                  Finyx WAAS
                </p>
                <h1 className="text-2xl font-semibold text-white">
                  Agent 驱动的 402 自动支付流程
                </h1>
                <p className="mt-2 text-sm text-white/80">
                  当服务返回 HTTP 402 时，Agent 自动完成支付并继续原始请求
                </p>
    
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-slate-900">
              Wallet context
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={resetCrossmintSession}
                disabled={isResettingSession}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-[#041126] bg-white/90 border border-white/60 shadow-lg transition hover:bg-white ${
                  isResettingSession ? "opacity-60 cursor-not-allowed" : ""
                }`}
              >
                {isResettingSession ? "重置中..." : "强制重新验证"}
              </button>
              <Link
                href="/"
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-[#041126] bg-white/90 border border-white/60 shadow-lg transition hover:bg-white"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Chain
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {wallet?.chain ?? "unknown"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Payment amount (USDC)
              </div>
              <input
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                placeholder="0.01"
              />
            </div>
            <div className="lg:col-span-2">
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Provider wallet
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900 break-all font-mono">
                {providerWallet || "Not set"}
              </div>
            </div>
          </div>
        </section>

        <PaymentGate amountInput={amountInput} />
      </div>
    </div>
  );
}
