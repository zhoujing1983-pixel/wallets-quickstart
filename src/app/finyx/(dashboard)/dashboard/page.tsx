"use client";

import { useEffect, useState } from "react";
import { useAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { useRouter } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { EmailDashboard } from "@/components/email-dashboard";

type EmailWallet = {
  address?: string;
  owner?: string;
  chain?: string;
  chainType?: string;
  type?: string;
  locator?: string;
  id?: string;
};

export default function FinyxDashboardPage() {
  const { wallet, status: walletStatus } = useWallet();
  const { status: authStatus } = useAuth();
  const router = useRouter();
  const [hasReadyOnce, setHasReadyOnce] = useState(false);
  const [hasEmailSession, setHasEmailSession] = useState(false);
  const [isCheckingEmailSession, setIsCheckingEmailSession] = useState(true);
  const [emailAddress, setEmailAddress] = useState("");
  const [emailWallet, setEmailWallet] = useState<EmailWallet | null>(null);
  const [isLoadingEmailWallet, setIsLoadingEmailWallet] = useState(false);
  const [emailWalletError, setEmailWalletError] = useState<string | null>(null);
  const [hasEmailWalletAttempted, setHasEmailWalletAttempted] = useState(false);

  const isAuthInitialized = authStatus !== "initializing";
  const isWalletReady = walletStatus !== "in-progress";
  const isReady = isAuthInitialized && isWalletReady;
  const isLoggedOut = authStatus === "logged-out";
  const isLoggingOut = isLoggedOut && !hasEmailSession;
  const isEmailWalletPending =
    hasEmailSession && !wallet && isLoadingEmailWallet;
  const shouldShowLoading =
    !hasReadyOnce || isLoggingOut || isCheckingEmailSession || isEmailWalletPending;
  const shouldShowEmailDashboard = !wallet && hasEmailSession;

  useEffect(() => {
    const checkEmailSession = async () => {
      try {
        const res = await fetch("/api/auth/email/session");
        if (res.ok) {
          const data = await res.json();
          setEmailAddress(data?.email ?? "");
          setHasEmailSession(true);
        }
      } catch (error) {
        console.warn("Email session check failed", error);
      } finally {
        setIsCheckingEmailSession(false);
      }
    };
    checkEmailSession();
  }, []);

  useEffect(() => {
    if (
      !hasEmailSession ||
      wallet ||
      emailWallet ||
      isLoadingEmailWallet ||
      hasEmailWalletAttempted
    ) {
      return;
    }
    const fetchEmailWallet = async () => {
      setHasEmailWalletAttempted(true);
      setIsLoadingEmailWallet(true);
      setEmailWalletError(null);
      try {
        const res = await fetch("/api/auth/email/wallet");
        const data = await res.json();
        if (!res.ok) {
          const baseError =
            typeof data?.error === "string"
              ? data.error
              : "Failed to fetch email wallet.";
          const detail =
            data?.details?.message ||
            data?.details?.error ||
            data?.details?.code ||
            "";
          setEmailWalletError(detail ? `${baseError} (${detail})` : baseError);
          return;
        }
        const normalized = data?.normalizedWallet ?? data?.wallet ?? null;
        setEmailWallet(normalized);
      } catch (error) {
        setEmailWalletError("Failed to fetch email wallet.");
      } finally {
        setIsLoadingEmailWallet(false);
      }
    };
    fetchEmailWallet();
  }, [
    hasEmailSession,
    wallet,
    emailWallet,
    isLoadingEmailWallet,
    hasEmailWalletAttempted,
  ]);

  useEffect(() => {
    if (isCheckingEmailSession) {
      return;
    }
    if (!isReady || !isLoggedOut || hasEmailSession) {
      return;
    }
    const timer = setTimeout(() => {
      router.replace("/finyx");
    }, 1000);
    return () => clearTimeout(timer);
  }, [isReady, isLoggedOut, hasEmailSession, isCheckingEmailSession, router]);

  useEffect(() => {
    if (isReady && !isCheckingEmailSession) {
      setHasReadyOnce(true);
    }
  }, [isReady, isCheckingEmailSession]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 relative">
        {shouldShowEmailDashboard ? (
          <EmailDashboard
            emailWallet={emailWallet}
            emailWalletError={emailWalletError}
            emailAddress={emailAddress}
            isEmailWalletLoading={isLoadingEmailWallet}
            onEmailLogout={() => {
              setHasEmailSession(false);
              setEmailWallet(null);
              setEmailAddress("");
              setHasEmailWalletAttempted(false);
            }}
          />
        ) : (
          <Dashboard />
        )}
        {shouldShowLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-sm">
            <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : null}
      </main>
    </div>
  );
}
