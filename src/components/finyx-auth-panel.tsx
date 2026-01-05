"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@crossmint/client-sdk-react-ui";
import { isEmailValid, type OAuthProvider } from "@crossmint/common-sdk-auth";
import { FinyxWalletPicker } from "@/components/finyx-wallet-picker";
import { EmailOtpModal } from "@/components/email-otp-modal";
import { useRouter } from "next/navigation";

type EmailOtpState = {
  email: string;
  emailId: string;
  expiresAt: number;
};

type Step = "email" | "otp";

const OAUTH_PROVIDERS: Array<{
  id: OAuthProvider;
  label: string;
  icon: string;
  iconAlt: string;
}> = [
  {
    id: "google",
    label: "Continue with Google",
    icon: "/finyx-auth-logos/google.png",
    iconAlt: "Google logo",
  },
  {
    id: "twitter",
    label: "Continue with X",
    icon: "/finyx-auth-logos/x.svg",
    iconAlt: "X logo",
  },
];

export function FinyxAuthPanel() {
  const {
    crossmintAuth,
    experimental_loginWithOAuth,
    login,
    loginMethods,
    status,
  } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailOtp, setEmailOtp] = useState<EmailOtpState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [isOkxInstalled, setIsOkxInstalled] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(
    null
  );

  const getResendSeconds = (availableAt: number | null) => {
    if (!availableAt) return 0;
    const remainingMs = availableAt - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  };

  const availableLoginMethods = useMemo(
    () => new Set(loginMethods ?? []),
    [loginMethods]
  );

  const canUseFarcaster = availableLoginMethods.has("farcaster");
  const canUseWeb3 = Array.from(availableLoginMethods).some((method) =>
    method.startsWith("web3")
  );

  const oauthProviders = useMemo(
    () =>
      OAUTH_PROVIDERS.filter((provider) =>
        availableLoginMethods.has(provider.id)
      ),
    [availableLoginMethods]
  );

  const handleSendEmailOtp = async () => {
    if (!isEmailValid(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await fetch("/api/auth/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          data?.error === "resend_not_available" &&
          typeof data?.resendAvailableAt === "number"
        ) {
          if (
            typeof data?.emailId === "string" &&
            typeof data?.expiresAt === "number"
          ) {
            setEmailOtp({
              email: normalizedEmail,
              emailId: data.emailId,
              expiresAt: data.expiresAt,
            });
          }
          setStep("otp");
          setResendAvailableAt(data.resendAvailableAt);
          setResendSeconds(getResendSeconds(data.resendAvailableAt));
          setSuccess("We already sent a code. Please check your inbox.");
          return;
        }
        throw new Error(data?.error ?? "Failed to send email.");
      }
      setEmailOtp({
        email: normalizedEmail,
        emailId: data.emailId,
        expiresAt: data.expiresAt,
      });
      setStep("otp");
      const availableAt =
        typeof data?.resendAvailableAt === "number"
          ? data.resendAvailableAt
          : Date.now() + 60_000;
      setResendAvailableAt(availableAt);
      setResendSeconds(getResendSeconds(availableAt));
    } catch (err) {
      console.error("Email OTP error", err);
      setError("Failed to send email. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmOtp = async () => {
    if (!emailOtp) {
      setError("Please request a verification code first.");
      return;
    }
    if (otp.trim().length < 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailOtp.email,
          emailId: emailOtp.emailId,
          code: otp.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorCode = typeof data?.error === "string" ? data.error : "";
        const errorMessage =
          errorCode === "code_not_found"
            ? "Code not found or expired. Please request a new code."
            : errorCode === "code_expired"
              ? "Code expired. Please request a new code."
              : errorCode === "invalid_code"
                ? "Invalid code. Please try again."
                : errorCode === "too_many_attempts"
                  ? "Too many attempts. Please request a new code."
                  : errorCode === "email_mismatch"
                    ? "Email mismatch. Please request a new code."
                    : "Invalid code. Please try again.";
        setError(errorMessage);
        return;
      }
      setIsRedirecting(true);
      router.replace("/finyx/dashboard");
    } catch (err) {
      console.error("OTP confirm error", err);
      setError("Verification failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!emailOtp) {
      setError("Please request a verification code first.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailOtp.email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          data?.error === "resend_not_available" &&
          typeof data?.resendAvailableAt === "number"
        ) {
          if (
            typeof data?.emailId === "string" &&
            typeof data?.expiresAt === "number"
          ) {
            setEmailOtp({
              email: emailOtp.email,
              emailId: data.emailId,
              expiresAt: data.expiresAt,
            });
          }
          setResendAvailableAt(data.resendAvailableAt);
          setResendSeconds(getResendSeconds(data.resendAvailableAt));
          setSuccess("We already sent a code. Please check your inbox.");
          return;
        }
        throw new Error(data?.error ?? "Failed to resend code.");
      }
      setEmailOtp({
        email: emailOtp.email,
        emailId: data.emailId,
        expiresAt: data.expiresAt,
      });
      const availableAt =
        typeof data?.resendAvailableAt === "number"
          ? data.resendAvailableAt
          : Date.now() + 60_000;
      setResendAvailableAt(availableAt);
      setResendSeconds(getResendSeconds(availableAt));
    } catch (err) {
      console.error("OTP resend error", err);
      setError("Failed to resend code. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    setError(null);
    try {
      await experimental_loginWithOAuth(provider);
    } catch (err) {
      console.error("OAuth error", err);
      setError("OAuth failed. Please try again.");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const okxProvider = (window as any).okxwallet;
    setIsOkxInstalled(Boolean(okxProvider?.request));
  }, []);

  useEffect(() => {
    if (step !== "otp") return;
    if (!resendAvailableAt) return;
    setResendSeconds(getResendSeconds(resendAvailableAt));
    const timer = window.setInterval(() => {
      setResendSeconds(getResendSeconds(resendAvailableAt));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAvailableAt, step]);

  const handleConnectOkx = async () => {
    if (!crossmintAuth) {
      setWalletError("Crossmint auth is not ready. Please try again.");
      return;
    }
    if (typeof window === "undefined") {
      setWalletError("Wallet connection is only available in the browser.");
      return;
    }
    const okxProvider = (window as any).okxwallet;
    if (!okxProvider?.request) {
      setWalletError("OKX Wallet not detected. Please install it first.");
      return;
    }
    setWalletError(null);
    setIsConnectingWallet(true);
    try {
      const accounts = await okxProvider.request({
        method: "eth_requestAccounts",
      });
      const address = accounts?.[0];
      if (!address) {
        throw new Error("No wallet address returned.");
      }
      const authStart = await crossmintAuth.signInWithSmartWallet(
        address,
        "evm"
      );
      const challenge =
        authStart?.challenge ?? authStart?.message ?? authStart?.nonce;
      if (!challenge || typeof challenge !== "string") {
        throw new Error("No challenge received from Crossmint.");
      }
      const signature = await okxProvider.request({
        method: "personal_sign",
        params: [challenge, address],
      });
      const authResult = await crossmintAuth.authenticateSmartWallet(
        address,
        "evm",
        signature
      );
      const oneTimeSecret = authResult?.oneTimeSecret;
      if (!oneTimeSecret) {
        throw new Error("No one-time secret received.");
      }
      await crossmintAuth.handleRefreshAuthMaterial(oneTimeSecret);
      setShowWalletPicker(false);
    } catch (err) {
      console.error("OKX connect error", err);
      setWalletError("Failed to connect OKX Wallet. Please try again.");
    } finally {
      setIsConnectingWallet(false);
    }
  };

  return (
    <div className="relative w-full max-w-md rounded-[28px] border border-white/60 bg-white/95 p-9 shadow-[0_24px_90px_rgba(15,23,42,0.18)] backdrop-blur">
      {isRedirecting ? (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.45em] text-slate-500">
          Finyx Wallet Access
        </p>
        <h2 className="mt-3 text-[28px] font-semibold text-slate-900">
          Welcome back
        </h2>
        <p className="mt-2 text-[13px] text-slate-500">
          Sign in to manage your wallet and activity securely.
        </p>
      </div>

      <div className="space-y-3.5">
        {oauthProviders.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-[15px] font-semibold leading-[20px] text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            onClick={() => handleOAuth(provider.id)}
          >
            <img
              src={provider.icon}
              alt={provider.iconAlt}
              className="h-5 w-5 shrink-0"
              loading="lazy"
            />
            <span className="flex-1 text-left leading-[20px]">
              {provider.label}
            </span>
          </button>
        ))}

        {canUseFarcaster && (
          <button
            type="button"
            className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-[15px] font-semibold text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            onClick={() => login()}
          >
            <img
              src="/finyx-auth-logos/farcaster.svg"
              alt="Farcaster logo"
              className="h-5 w-5 shrink-0"
              loading="lazy"
            />
            <span className="flex-1 text-left">Continue with Farcaster</span>
          </button>
        )}

        {canUseWeb3 && (
          <button
            type="button"
            className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-[15px] font-semibold leading-[20px] text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            onClick={() => setShowWalletPicker(true)}
          >
            <img
              src="/finyx-auth-logos/wallet.svg"
              alt="Wallet"
              className="h-5 w-5 shrink-0"
              loading="lazy"
            />
            <span className="flex-1 text-left leading-[20px]">
              Continue with a wallet
            </span>
            <span className="text-lg text-slate-400">›</span>
          </button>
        )}
      </div>

      <>
        <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          <span>OR</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="space-y-3">
            <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              Email
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 outline-none transition focus:border-slate-400"
              />
              <button
                type="button"
                onClick={handleSendEmailOtp}
                disabled={isSubmitting || status === "in-progress"}
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-600 sm:w-auto"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {success}
        </div>
      )}

      <p className="mt-6 text-[11px] text-slate-400">
         By continuing, you accept the{" "}
            <a
              href="https://www.finyx.com/legal/terms-of-service"
              target="_blank"
              rel="noreferrer"
              className="text-[#ffad40] hover:text-[#ff9927]"
            >
              Wallet&apos;s Terms of Service
            </a>
            , and to receive updates from Finyx.
      </p>

      <FinyxWalletPicker
        open={showWalletPicker}
        onClose={() => setShowWalletPicker(false)}
        onBack={() => setShowWalletPicker(false)}
        isConnecting={isConnectingWallet}
        error={walletError}
        wallets={[
          {
            id: "okx",
            name: "OKX Wallet",
            icon: "/finyx-auth-logos/okx.svg",
            installed: isOkxInstalled,
            onClick: handleConnectOkx,
          },
        ]}
      />

      {step === "otp" && (
        <EmailOtpModal
          open
          email={emailOtp?.email ?? email}
          otp={otp}
          resendSeconds={resendSeconds}
          isSubmitting={isSubmitting || status === "in-progress"}
          error={error}
          onClose={() => {
            setStep("email");
            setOtp("");
            setError(null);
          }}
          onOtpChange={(value) => {
            setOtp(value);
            setError(null);
          }}
          onConfirm={handleConfirmOtp}
          onResend={handleResendOtp}
        />
      )}
        </>
      )}
    </div>
  );
}
