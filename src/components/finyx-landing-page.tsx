"use client";

import { FinyxAuthPanel } from "@/components/finyx-auth-panel";

export function FinyxLandingPage({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-5">
      <div
        className="relative hidden lg:block col-span-2 bg-center bg-cover"
        style={{ backgroundImage: "url('/wallet-card-hand.jpg')" }}
        aria-hidden="true"
      />

      <div className="flex flex-col items-center justify-center bg-slate-50 px-6 py-12 col-span-1 lg:col-span-3">
        <div className="lg:hidden mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Finyx Wallets
          </h1>
          <p className="text-slate-500">
            Get started with the Finyx Wallets Quickstart
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <FinyxAuthPanel />
        )}
      </div>
    </div>
  );
}
