"use client";

import { useRef } from "react";
import { useAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { LandingPage } from "@/components/landing-page";
import { CSSTransition, SwitchTransition } from "react-transition-group";
import { Dashboard } from "@/components/dashboard";

export default function Home() {
  const { wallet, status: walletStatus } = useWallet();
  const { status: authStatus } = useAuth();
  const nodeRef = useRef(null);

  const isLoggedIn = wallet != null && authStatus === "logged-in";
  const isLoggedOut = authStatus === "logged-out";
  const isAuthInitialized = authStatus !== "initializing";
  const isWalletReady = walletStatus !== "in-progress";
  const isReady = isAuthInitialized && isWalletReady;
  const shouldShowLanding = isReady && isLoggedOut;
  const shouldShowDashboard = isLoggedIn;
  const shouldShowLoading = !shouldShowLanding && !shouldShowDashboard;

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
        <SwitchTransition mode="out-in">
          <CSSTransition
            key={isLoggedIn ? "dashboard" : "landing"}
            nodeRef={nodeRef}
            timeout={400}
            classNames="page-transition"
            unmountOnExit
          >
            <div ref={nodeRef}>
              {shouldShowDashboard ? (
                <Dashboard />
              ) : (
                <LandingPage isLoading={false} />
              )}
            </div>
          </CSSTransition>
        </SwitchTransition>
      </main>
    </div>
  );
}
