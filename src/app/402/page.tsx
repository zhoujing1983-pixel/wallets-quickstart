"use client";

import { PaymentGate } from "@/components/payment-gate";

export default function Demo402Page() {
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

        <PaymentGate />
      </div>
    </div>
  );
}
