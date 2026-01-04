"use client";

import { useEffect, useState } from "react";
import { useAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { useRouter } from "next/navigation";
import { Dashboard } from "@/components/dashboard";

export default function FinyxDashboardPage() {
  const { wallet, status: walletStatus } = useWallet();
  const { status: authStatus } = useAuth();
  const router = useRouter();
  const [hasReadyOnce, setHasReadyOnce] = useState(false);

  const isLoggedIn = wallet != null && authStatus === "logged-in";
  const isAuthInitialized = authStatus !== "initializing";
  const isWalletReady = walletStatus !== "in-progress";
  const isReady = isAuthInitialized && isWalletReady;
  const isLoggedOut = authStatus === "logged-out";
  const isLoggingOut = isLoggedOut;
  const shouldShowLoading = !hasReadyOnce || isLoggingOut;

  useEffect(() => {
    if (!isReady || !isLoggedOut) {
      return;
    }
    const timer = setTimeout(() => {
      router.replace("/finyx");
    }, 1000);
    return () => clearTimeout(timer);
  }, [isReady, isLoggedOut, router]);

  useEffect(() => {
    if (isReady) {
      setHasReadyOnce(true);
    }
  }, [isReady]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 relative">
        <Dashboard />
        {shouldShowLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-sm">
            <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : null}
      </main>
    </div>
  );
}
