"use client";

import { useEffect } from "react";
import { useAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { useRouter } from "next/navigation";
import { FinyxLandingPage } from "@/components/finyx-landing-page";

export default function FinyxHome() {
  const { wallet, status: walletStatus } = useWallet();
  const { status: authStatus } = useAuth();
  const router = useRouter();

  const isLoggedIn = wallet != null && authStatus === "logged-in";
  const isLoading =
    walletStatus === "in-progress" || authStatus === "initializing";
  const shouldShowLoading = isLoading || isLoggedIn;

  useEffect(() => {
    if (isLoggedIn) {
      router.replace("/finyx/dashboard");
    }
  }, [isLoggedIn, router]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <FinyxLandingPage isLoading={shouldShowLoading} />
      </main>
    </div>
  );
}
