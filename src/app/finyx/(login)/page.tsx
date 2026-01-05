"use client";

import { useEffect, useState } from "react";
import { useAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { useRouter } from "next/navigation";
import { FinyxLandingPage } from "@/components/finyx-landing-page";

export default function FinyxHome() {
  const { wallet, status: walletStatus } = useWallet();
  const { status: authStatus } = useAuth();
  const router = useRouter();
  const [isCheckingEmailSession, setIsCheckingEmailSession] = useState(true);

  const isLoggedIn = wallet != null && authStatus === "logged-in";
  const isLoading =
    walletStatus === "in-progress" || authStatus === "initializing";
  const shouldShowLoading = isLoading || isLoggedIn || isCheckingEmailSession;

  useEffect(() => {
    if (isLoggedIn) {
      router.replace("/finyx/dashboard");
    }
  }, [isLoggedIn, router]);

  useEffect(() => {
    const checkEmailSession = async () => {
      try {
        const res = await fetch("/api/auth/email/session");
        if (res.ok) {
          router.replace("/finyx/dashboard");
          return;
        }
      } catch (error) {
        console.warn("Email session check failed", error);
      } finally {
        setIsCheckingEmailSession(false);
      }
    };
    checkEmailSession();
  }, [router]);

  if (shouldShowLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <FinyxLandingPage isLoading={false} />
      </main>
    </div>
  );
}
