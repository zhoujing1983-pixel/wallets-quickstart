"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { SolanaWallet } from "@crossmint/wallets-sdk";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

type ProviderResponse = {
  [key: string]: unknown;
};

const DEFAULT_AMOUNT = "0.01";

type PaymentGateProps = {
  amountInput?: string;
  onAmountInputChange?: (value: string) => void;
};

export function PaymentGate({
  amountInput: amountInputProp,
}: PaymentGateProps) {
  const { wallet } = useWallet();
  const walletAddress = wallet?.address ?? "";
  const providerWallet =
    process.env.NEXT_PUBLIC_PROVIDER_WALLET ?? "";

  const [internalAmountInput] = useState(DEFAULT_AMOUNT);
  const amountInput = amountInputProp ?? internalAmountInput;
  const [currency, setCurrency] = useState("USDC");
  const [authSessionId, setAuthSessionId] = useState("");
  const [intentAuthHash, setIntentAuthHash] = useState<string | null>(null);
  const [delegationAuthHash, setDelegationAuthHash] = useState<string | null>(
    null
  );
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [receiptPayload, setReceiptPayload] = useState<Record<string, unknown> | null>(
    null
  );
  const [receiptQrDataUrl, setReceiptQrDataUrl] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txHashInput, setTxHashInput] = useState("");
  const [explorerLink, setExplorerLink] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<number | null>(null);
  const [providerResponse, setProviderResponse] =
    useState<ProviderResponse | null>(null);
  const [providerResponses, setProviderResponses] = useState<
    Array<{
      status: number;
      data: ProviderResponse;
      withReceipt: boolean;
      timestamp: number;
    }>
  >([]);
  const [stepResults, setStepResults] = useState<
    Array<{
      flow: "A" | "B";
      step: string;
      data: Record<string, unknown>;
      timestamp: number;
    }>
  >([]);
  const [resultTab, setResultTab] = useState<"A" | "B">("A");
  const [networkCheckSignature, setNetworkCheckSignature] = useState("");
  const [networkCheckResult, setNetworkCheckResult] = useState<string | null>(
    null
  );
  const [isNetworkChecking, setIsNetworkChecking] = useState(false);
  const [isProviderLoading, setIsProviderLoading] = useState(false);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [intentMessage, setIntentMessage] = useState<string | null>(null);
  const [intentToken, setIntentToken] = useState<string | null>(null);
  const [intentSignature, setIntentSignature] = useState<string | null>(null);
  const [intentAuthorizationToken, setIntentAuthorizationToken] =
    useState<string | null>(null);
  const [intentSignatureVerified, setIntentSignatureVerified] =
    useState<boolean | null>(null);
  const [delegationMessage, setDelegationMessage] = useState<string | null>(
    null
  );
  const [delegationChallengeToken, setDelegationChallengeToken] =
    useState<string | null>(null);
  const [delegationSignature, setDelegationSignature] = useState<string | null>(
    null
  );
  const [delegationToken, setDelegationToken] = useState<string | null>(null);
  const [delegationSignatureVerified, setDelegationSignatureVerified] =
    useState<boolean | null>(null);
  const [isSigningIntent, setIsSigningIntent] = useState(false);
  const [isVerifyingIntent, setIsVerifyingIntent] = useState(false);
  const [isCreatingDelegation, setIsCreatingDelegation] = useState(false);
  const [isSigningDelegation, setIsSigningDelegation] = useState(false);
  const [isMintingDelegation, setIsMintingDelegation] = useState(false);
  const [requireManualApproval, setRequireManualApproval] = useState(false);
  const [lastSignatureId, setLastSignatureId] = useState<string | null>(null);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(
    null
  );
  const [lastApproveResult, setLastApproveResult] = useState<string | null>(
    null
  );
  const [lastApproveError, setLastApproveError] = useState<string | null>(null);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [manualStepRunning, setManualStepRunning] = useState<string | null>(
    null
  );
  const [isBAutoRunning, setIsBAutoRunning] = useState(false);
  const [manualBStepRunning, setManualBStepRunning] = useState<string | null>(
    null
  );
  const [aFlowError, setAFlowError] = useState<string | null>(null);
  const [aFlowSteps, setAFlowSteps] = useState<
    Array<{ id: string; label: string; status: "pending" | "running" | "success" | "error" }>
  >([
    { id: "provider-402", label: "触发 402", status: "pending" },
    { id: "intent-create", label: "生成 intent", status: "pending" },
    { id: "intent-sign", label: "签名 intent", status: "pending" },
    { id: "intent-verify", label: "intent 验签", status: "pending" },
    { id: "waas-pay", label: "WaaS 支付", status: "pending" },
    { id: "receipt-mint", label: "生成 receipt", status: "pending" },
    { id: "provider-access", label: "凭证放行", status: "pending" },
  ]);
  const [bFlowError, setBFlowError] = useState<string | null>(null);
  const [bFlowSteps, setBFlowSteps] = useState<
    Array<{ id: string; label: string; status: "pending" | "running" | "success" | "error" }>
  >([
    { id: "provider-402", label: "触发 402", status: "pending" },
    { id: "delegation-challenge", label: "生成委托", status: "pending" },
    { id: "delegation-sign", label: "签名委托", status: "pending" },
    { id: "delegation-mint", label: "委托验签", status: "pending" },
    { id: "waas-pay", label: "WaaS 支付", status: "pending" },
    { id: "receipt-mint", label: "生成 receipt", status: "pending" },
    { id: "provider-access", label: "凭证放行", status: "pending" },
  ]);

  const amount = useMemo(() => {
    const parsed = Number(amountInput);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [amountInput]);
  const memoTx = useMemo(() => {
    const entry = [...stepResults]
      .reverse()
      .find((item) => typeof item.data?.memo_tx === "string");
    return entry ? String(entry.data.memo_tx) : null;
  }, [stepResults]);
  const memoOnChain = Boolean(memoTx);
  const memoCluster = useMemo(() => {
    const rpc =
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      process.env.NEXT_PUBLIC_RPC_URL ??
      "";
    if (rpc.includes("devnet")) return "devnet";
    if (rpc.includes("testnet")) return "testnet";
    return "mainnet-beta";
  }, []);
  const memoExplorerLink = memoTx
    ? `https://explorer.solana.com/tx/${memoTx}?cluster=${memoCluster}`
    : null;
  useEffect(() => {
    if (!receipt) {
      setReceiptQrDataUrl(null);
      return;
    }
    let active = true;
    QRCode.toDataURL(receipt, { width: 180, margin: 1 })
      .then((url) => {
        if (active) {
          setReceiptQrDataUrl(url);
        }
      })
      .catch(() => {
        if (active) {
          setReceiptQrDataUrl(null);
        }
      });
    return () => {
      active = false;
    };
  }, [receipt]);
  const receiptIssuedAt = useMemo(() => {
    const iat = receiptPayload?.iat;
    return typeof iat === "number"
      ? new Date(iat * 1000).toLocaleString()
      : "-";
  }, [receiptPayload]);
  const receiptExpiresAt = useMemo(() => {
    const exp = receiptPayload?.exp;
    return typeof exp === "number"
      ? new Date(exp * 1000).toLocaleString()
      : "-";
  }, [receiptPayload]);

  const resolveAuthHashForMessage = (message: string | null) => {
    if (!message) {
      return null;
    }
    if (message === intentMessage) {
      return intentAuthHash;
    }
    if (message === delegationMessage) {
      return delegationAuthHash;
    }
    return null;
  };

  useEffect(() => {
    if (authSessionId) {
      return;
    }
    const browserCrypto =
      typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    const generated =
      browserCrypto?.randomUUID?.() ??
      `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setAuthSessionId(generated);
  }, [authSessionId]);

  const signWithWallet = async (message: string): Promise<string | null> => {
    if (!wallet) {
      alert("Wallet not connected.");
      return null;
    }

    const signMessageFn = (wallet as { signMessage?: unknown }).signMessage;
    const chain = String(wallet.chain ?? "").toLowerCase();
    const isSolana = chain.includes("solana");

    if (typeof signMessageFn !== "function") {
      if (isSolana) {
        try {
          const authHash = resolveAuthHashForMessage(message);
          const res = await fetch("/api/solana/memo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              walletAddress,
              auth_hash: authHash ?? undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data?.error ?? "Failed to build memo transaction");
          }
          const solanaWallet = SolanaWallet.from(wallet as any);
          const serialized =
            typeof data?.serializedTransactionBase58 === "string"
              ? data.serializedTransactionBase58
              : data.serializedTransaction;
          const txn = await solanaWallet.sendTransaction({
            serializedTransaction: serialized,
            options: requireManualApproval ? { experimental_prepareOnly: true } : undefined,
          });
          if (requireManualApproval) {
            const transactionId =
              typeof (txn as { transactionId?: unknown })?.transactionId ===
              "string"
                ? (txn as { transactionId: string }).transactionId
                : null;
            if (!transactionId) {
              throw new Error("Missing transactionId for manual approval.");
            }
            setLastTransactionId(transactionId);
            setLastApproveError(null);
            setLastApproveResult(null);
            const approved = await (solanaWallet as any).approve({
              transactionId,
            });
            const approvedHash =
              typeof (approved as { hash?: unknown })?.hash === "string"
                ? (approved as { hash: string }).hash
                : null;
            setLastApproveResult(approvedHash ?? "approved");
            return approvedHash ?? transactionId;
          }

          const signature =
            typeof (txn as { hash?: unknown })?.hash === "string"
              ? (txn as { hash: string }).hash
              : typeof (txn as { transactionId?: unknown })?.transactionId ===
                  "string"
                ? (txn as { transactionId: string }).transactionId
                : null;
          return signature;
        } catch (error) {
          alert(`Memo signature failed: ${error}`);
          return null;
        }
      }

      alert("Wallet does not support signMessage.");
      return null;
    }
    try {
      if (requireManualApproval) {
        const result = await (
          wallet as unknown as {
            signMessage: (params: {
              message: string;
              options?: { experimental_prepareOnly: boolean };
            }) => Promise<{ signature?: string; signatureId?: string } | string>;
          }
        ).signMessage({
          message,
          options: { experimental_prepareOnly: true },
        });
        const signatureId =
          typeof result === "object" && result && "signatureId" in result
            ? (result as { signatureId?: string }).signatureId ?? null
            : null;
        if (!signatureId) {
          throw new Error("Missing signatureId for manual approval.");
        }
        setLastSignatureId(signatureId);
        setLastApproveError(null);
        setLastApproveResult(null);
        const approved = await (wallet as any).approve({ signatureId });
        const approvedSignature =
          typeof (approved as { signature?: unknown })?.signature === "string"
            ? (approved as { signature: string }).signature
            : null;
        setLastApproveResult(approvedSignature ?? "approved");
        return approvedSignature ?? null;
      }

      const result = await (
        wallet as unknown as {
          signMessage: (params: { message: string }) => Promise<{ signature?: string } | string>;
        }
      ).signMessage({ message });
      const signature =
        typeof result === "string"
          ? result
          : typeof result?.signature === "string"
            ? result.signature
            : null;
      return signature;
    } catch (error) {
      setLastApproveError(String(error));
      if (error instanceof Error && error.name === "AuthRejectedError") {
        return null;
      }
      alert(`Signature failed: ${error}`);
      return null;
    }
  };

  const handleManualApprove = async () => {
    if (!wallet) {
      alert("Wallet not connected.");
      return;
    }
    setLastApproveError(null);
    setLastApproveResult(null);
    try {
      if (lastSignatureId) {
        const approved = await (wallet as any).approve({
          signatureId: lastSignatureId,
        });
        const approvedSignature =
          typeof (approved as { signature?: unknown })?.signature === "string"
            ? (approved as { signature: string }).signature
            : null;
        setLastApproveResult(approvedSignature ?? "approved");
        return;
      }
      if (lastTransactionId) {
        const solanaWallet = SolanaWallet.from(wallet as any);
        const approved = await (solanaWallet as any).approve({
          transactionId: lastTransactionId,
        });
        const approvedHash =
          typeof (approved as { hash?: unknown })?.hash === "string"
            ? (approved as { hash: string }).hash
            : null;
        setLastApproveResult(approvedHash ?? "approved");
      }
    } catch (error) {
      setLastApproveError(String(error));
    }
  };

  const checkSolanaNetwork = async () => {
    if (!networkCheckSignature) {
      setNetworkCheckResult("请输入交易 signature");
      return;
    }
    setIsNetworkChecking(true);
    setNetworkCheckResult(null);
    try {
      const res = await fetch("/api/solana/network-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: networkCheckSignature }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "network check failed");
      }
      setNetworkCheckResult(data?.result ?? "no result");
    } catch (error) {
      setNetworkCheckResult(`错误: ${String(error)}`);
    } finally {
      setIsNetworkChecking(false);
    }
  };

  const callProvider = async (
    withReceipt: boolean,
    receiptOverride?: string | null
  ) => {
    setIsProviderLoading(true);
    try {
      const res = await fetch("/api/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receipt: withReceipt ? receiptOverride ?? receipt : undefined,
          amount: amountInput,
          currency,
        }),
      });
      const data = await res.json();
      setProviderStatus(res.status);
      setProviderResponse(data);
      setProviderResponses((prev) => [
        ...prev,
        {
          status: res.status,
          data,
          withReceipt,
          timestamp: Date.now(),
        },
      ]);
      if (res.status === 402 && data?.payment_intent_id) {
        setPaymentIntentId(String(data.payment_intent_id));
      }
      return { status: res.status, data };
    } catch (error) {
      setProviderStatus(500);
      setProviderResponse({ error: "provider_error", details: String(error) });
      return null;
    } finally {
      setIsProviderLoading(false);
    }
  };

  const createBillingIntent = async () => {
    setIsBillingLoading(true);
    try {
      const res = await fetch("/api/billing/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountInput,
          currency,
          walletAddress,
          auth_session_id: authSessionId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to create intent");
      }
      const sessionId =
        typeof data?.auth_session_id === "string" && data.auth_session_id
          ? data.auth_session_id
          : authSessionId;
      const authHash =
        typeof data?.auth_hash === "string" ? data.auth_hash : null;
      if (sessionId) {
        setAuthSessionId(sessionId);
      }
      setIntentAuthHash(authHash);
      setPaymentIntentId(String(data.payment_intent_id));
      setIntentMessage(
        typeof data?.intent_message === "string" ? data.intent_message : null
      );
      setIntentToken(
        typeof data?.intent_token === "string" ? data.intent_token : null
      );
      setIntentSignature(null);
      setIntentAuthorizationToken(null);
      setIntentSignatureVerified(null);
      return {
        payment_intent_id: String(data.payment_intent_id ?? ""),
        intent_message:
          typeof data?.intent_message === "string" ? data.intent_message : null,
        intent_token:
          typeof data?.intent_token === "string" ? data.intent_token : null,
        auth_session_id: sessionId,
        auth_hash: authHash,
      };
    } catch (error) {
      setProviderResponse({ error: "billing_error", details: String(error) });
      return null;
    } finally {
      setIsBillingLoading(false);
    }
  };

  const signIntent = async (messageOverride?: string | null) => {
    const message = messageOverride ?? intentMessage;
    if (!message) {
      alert("Create a payment intent first.");
      return null;
    }
    setIsSigningIntent(true);
    const signature = await signWithWallet(message);
    setIntentSignature(signature);
    setIsSigningIntent(false);
    return signature;
  };

  const verifyIntentSignature = async (
    tokenOverride?: string | null,
    signatureOverride?: string | null
  ) => {
    const token = tokenOverride ?? intentToken;
    const signature = signatureOverride ?? intentSignature;
    if (!token || !signature) {
      alert("Sign the intent first.");
      return null;
    }
    setIsVerifyingIntent(true);
    try {
      const res = await fetch("/api/billing/intent/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent_token: token,
          signature: signature,
          walletAddress,
          chain: wallet?.chain ?? "solana",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Intent verification failed");
      }
      setIntentAuthorizationToken(
        typeof data?.intent_authorization_token === "string"
          ? data.intent_authorization_token
          : null
      );
      const verified =
        typeof data?.signature_verified === "boolean"
          ? data.signature_verified
          : null;
      setIntentSignatureVerified(verified);
      const tokenValue =
        typeof data?.intent_authorization_token === "string"
          ? data.intent_authorization_token
          : null;
      return { token: tokenValue, verified };
    } catch (error) {
      setProviderResponse({
        error: "intent_verification_error",
        details: String(error),
      });
      setAFlowError(String(error));
      return null;
    } finally {
      setIsVerifyingIntent(false);
    }
  };

  const createDelegationChallenge = async () => {
    setIsCreatingDelegation(true);
    try {
      const res = await fetch("/api/billing/delegation/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          limit: amountInput,
          currency,
          agent_id: "finyx-agent",
          auth_session_id: authSessionId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Delegation challenge failed");
      }
      const sessionId =
        typeof data?.auth_session_id === "string" && data.auth_session_id
          ? data.auth_session_id
          : authSessionId;
      const authHash =
        typeof data?.auth_hash === "string" ? data.auth_hash : null;
      if (sessionId) {
        setAuthSessionId(sessionId);
      }
      setDelegationAuthHash(authHash);
      setDelegationMessage(
        typeof data?.delegation_message === "string"
          ? data.delegation_message
          : null
      );
      setDelegationChallengeToken(
        typeof data?.challenge_token === "string" ? data.challenge_token : null
      );
      setDelegationSignature(null);
      setDelegationToken(null);
      setDelegationSignatureVerified(null);
      return {
        delegation_message:
          typeof data?.delegation_message === "string"
            ? data.delegation_message
            : null,
        challenge_token:
          typeof data?.challenge_token === "string" ? data.challenge_token : null,
        auth_session_id: sessionId,
        auth_hash: authHash,
      };
    } catch (error) {
      setProviderResponse({
        error: "delegation_challenge_error",
        details: String(error),
      });
      return null;
    } finally {
      setIsCreatingDelegation(false);
    }
  };

  const signDelegation = async (messageOverride?: string | null) => {
    const message = messageOverride ?? delegationMessage;
    if (!message) {
      alert("Create a delegation challenge first.");
      return null;
    }
    setIsSigningDelegation(true);
    const signature = await signWithWallet(message);
    setDelegationSignature(signature);
    setIsSigningDelegation(false);
    return signature;
  };

  const mintDelegationToken = async (
    challengeOverride?: string | null,
    signatureOverride?: string | null
  ) => {
    const challenge = challengeOverride ?? delegationChallengeToken;
    const signature = signatureOverride ?? delegationSignature;
    if (!challenge || !signature) {
      alert("Sign the delegation message first.");
      return null;
    }
    setIsMintingDelegation(true);
    try {
      const res = await fetch("/api/billing/delegation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_token: challenge,
          signature,
          walletAddress,
          chain: wallet?.chain ?? "solana",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Delegation mint failed");
      }
      setDelegationToken(
        typeof data?.delegation_token === "string"
          ? data.delegation_token
          : null
      );
      setDelegationSignatureVerified(
        typeof data?.signature_verified === "boolean"
          ? data.signature_verified
          : null
      );
      return typeof data?.delegation_token === "string"
        ? data.delegation_token
        : null;
    } catch (error) {
      setProviderResponse({
        error: "delegation_mint_error",
        details: String(error),
      });
      setBFlowError(String(error));
      return null;
    } finally {
      setIsMintingDelegation(false);
    }
  };

  const handlePay = async () => {
    if (!wallet) {
      alert("Wallet not connected.");
      return null;
    }
    if (!providerWallet) {
      alert("Set NEXT_PUBLIC_PROVIDER_WALLET to a valid address.");
      return null;
    }
    if (currency !== "USDC") {
      alert("Current WaaS demo supports USDC only.");
      return null;
    }
    if (!amount) {
      alert("Enter a valid amount.");
      return null;
    }

    setIsPaying(true);
    try {
      const txn = await wallet.send(providerWallet, "usdc", amount.toString());
      const anyTxn = txn as Record<string, unknown>;
      const resolvedHash =
        typeof anyTxn.transactionHash === "string"
          ? anyTxn.transactionHash
          : typeof anyTxn.txId === "string"
            ? anyTxn.txId
            : typeof anyTxn.hash === "string"
              ? anyTxn.hash
              : "";
      setTxHash(resolvedHash ? resolvedHash : null);
      setTxHashInput(resolvedHash);
      setExplorerLink(
        "explorerLink" in txn && typeof txn.explorerLink === "string"
          ? txn.explorerLink
          : null
      );
      return resolvedHash || null;
    } catch (error) {
      if (error instanceof Error && error.name === "AuthRejectedError") {
        return null;
      }
      alert(`Payment failed: ${error}`);
      return null;
    } finally {
      setIsPaying(false);
    }
  };

  const mintReceipt = async (
    intentIdOverride?: string | null,
    txHashOverride?: string | null,
    intentAuthOverride?: string | null,
    delegationOverride?: string | null
  ) => {
    const intentId = intentIdOverride ?? paymentIntentId;
    const txHashValue = txHashOverride ?? txHashInput;
    const intentAuth = intentAuthOverride ?? intentAuthorizationToken;
    const delegation = delegationOverride ?? delegationToken;
    if (!intentId) {
      alert("Create a payment intent first.");
      return null;
    }
    if (!txHashValue) {
      alert("Enter the transaction hash.");
      return null;
    }
    setIsMinting(true);
    try {
      const res = await fetch("/api/billing/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountInput,
          currency,
          walletAddress,
          payment_intent_id: intentId,
          tx_hash: txHashValue,
          chain_id: wallet?.chain ?? "solana",
          intent_authorization_token: intentAuth ?? undefined,
          delegation_token: delegation ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to mint receipt");
      }
      const receiptValue =
        typeof data?.receipt === "string" ? data.receipt : null;
      const receiptPayloadValue =
        data?.receipt_payload && typeof data.receipt_payload === "object"
          ? (data.receipt_payload as Record<string, unknown>)
          : null;
      setReceipt(receiptValue);
      setReceiptPayload(receiptPayloadValue);
      setProviderResponse(data);
      return receiptValue
        ? { receipt: receiptValue, receipt_payload: receiptPayloadValue }
        : null;
    } catch (error) {
      setProviderResponse({ error: "receipt_error", details: String(error) });
      return null;
    } finally {
      setIsMinting(false);
    }
  };

  const runAFlow = async () => {
    if (isAutoRunning) return;
    setIsAutoRunning(true);
    try {
      setAFlowError(null);
      setProviderResponses([]);
      setStepResults([]);
      setAFlowSteps((prev) =>
        prev.map((step) => ({ ...step, status: "pending" }))
      );
      const updateStep = (
        id: string,
        status: "running" | "success" | "error"
      ) => {
        setAFlowSteps((prev) =>
          prev.map((step) =>
            step.id === id ? { ...step, status } : step
          )
        );
      };

      updateStep("provider-402", "running");
      const providerFirst = await callProvider(false);
      if (providerFirst) {
        setStepResults((prev) => [
          ...prev,
          {
            flow: "A",
            step: "触发 402",
            data: providerFirst.data,
            timestamp: Date.now(),
          },
        ]);
      }
      updateStep("provider-402", "success");

      updateStep("intent-create", "running");
      const intentResult = await createBillingIntent();
      if (!intentResult?.payment_intent_id) {
        updateStep("intent-create", "error");
        setAFlowError("生成 intent 失败");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "A",
          step: "生成 intent",
          data: {
            payment_intent_id: intentResult.payment_intent_id,
            intent_message: intentResult.intent_message,
            auth_session_id: intentResult.auth_session_id,
            auth_hash: intentResult.auth_hash,
          },
          timestamp: Date.now(),
        },
      ]);
      updateStep("intent-create", "success");

      updateStep("intent-sign", "running");
      const signature = await signIntent(intentResult?.intent_message ?? null);
      if (!signature) {
        updateStep("intent-sign", "error");
        setAFlowError("签名 intent 失败或被拒绝");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "A",
          step: "签名 intent",
          data: { signature, memo_tx: signature },
          timestamp: Date.now(),
        },
      ]);
      updateStep("intent-sign", "success");

      updateStep("intent-verify", "running");
      const verifyResult = await verifyIntentSignature(
        intentResult?.intent_token ?? null,
        signature
      );
      if (!verifyResult?.token) {
        updateStep("intent-verify", "error");
        setAFlowError("intent 验签失败");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "A",
          step: "intent 验签",
          data: {
            authorization_token: verifyResult.token,
            signature_verified: verifyResult.verified,
          },
          timestamp: Date.now(),
        },
      ]);
      updateStep("intent-verify", "success");

      updateStep("waas-pay", "running");
      const hash = await handlePay();
      if (!hash) {
        updateStep("waas-pay", "error");
        setAFlowError("WaaS 支付失败或被拒绝");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "A",
          step: "WaaS 支付",
          data: { tx_hash: hash },
          timestamp: Date.now(),
        },
      ]);
      updateStep("waas-pay", "success");

      updateStep("receipt-mint", "running");
      const receiptResult = await mintReceipt(
        intentResult?.payment_intent_id ?? paymentIntentId,
        hash,
        verifyResult.token,
        null
      );
      if (!receiptResult?.receipt) {
        updateStep("receipt-mint", "error");
        setAFlowError("生成 receipt 失败");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "A",
          step: "生成 receipt",
          data: {
            receipt: receiptResult.receipt,
            receipt_payload: receiptResult.receipt_payload ?? undefined,
          },
          timestamp: Date.now(),
        },
      ]);
      updateStep("receipt-mint", "success");

      updateStep("provider-access", "running");
      const providerSecond = await callProvider(true, receiptResult.receipt);
      if (providerSecond) {
        setStepResults((prev) => [
          ...prev,
          {
            flow: "A",
            step: "凭证放行",
            data: providerSecond.data,
            timestamp: Date.now(),
          },
        ]);
      }
      updateStep("provider-access", "success");
    } finally {
      setIsAutoRunning(false);
    }
  };

  const updateStepStatus = (
    id: string,
    status: "running" | "success" | "error"
  ) => {
    setAFlowSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, status } : step))
    );
  };

  const updateBStepStatus = (
    id: string,
    status: "running" | "success" | "error"
  ) => {
    setBFlowSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, status } : step))
    );
  };

  const runManualStep = async (id: string) => {
    if (manualStepRunning || isAutoRunning) {
      return;
    }
    setManualStepRunning(id);
    setAFlowError(null);
    updateStepStatus(id, "running");
    try {
      let ok = false;
      switch (id) {
        case "provider-402": {
          const result = await callProvider(false);
          ok = Boolean(result);
          if (result) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "A",
                step: "触发 402",
                data: result.data,
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "intent-create": {
          const result = await createBillingIntent();
          ok = Boolean(result?.payment_intent_id);
          if (result?.payment_intent_id) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "A",
                step: "生成 intent",
                data: {
                  payment_intent_id: result.payment_intent_id,
                  intent_message: result.intent_message,
                  auth_session_id: result.auth_session_id,
                  auth_hash: result.auth_hash,
                },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "intent-sign": {
          const signature = await signIntent();
          ok = Boolean(signature);
          if (signature) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "A",
                step: "签名 intent",
                data: { signature, memo_tx: signature },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "intent-verify": {
          const result = await verifyIntentSignature();
          ok = Boolean(result?.token);
          if (result?.token) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "A",
                step: "intent 验签",
                data: {
                  authorization_token: result.token,
                  signature_verified: result.verified,
                },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "waas-pay": {
          const hash = await handlePay();
          ok = Boolean(hash);
          if (hash) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "A",
                step: "WaaS 支付",
                data: { tx_hash: hash },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "receipt-mint": {
          const receiptResult = await mintReceipt();
          ok = Boolean(receiptResult?.receipt);
          if (receiptResult?.receipt) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "A",
                step: "生成 receipt",
                data: {
                  receipt: receiptResult.receipt,
                  receipt_payload: receiptResult.receipt_payload ?? undefined,
                },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "provider-access": {
          const result = await callProvider(true, receipt);
          ok = Boolean(result);
          if (result) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "A",
                step: "凭证放行",
                data: result.data,
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        default:
          ok = false;
      }
      if (!ok) {
        updateStepStatus(id, "error");
        setAFlowError(`步骤失败：${id}`);
        return;
      }
      updateStepStatus(id, "success");
    } finally {
      setManualStepRunning(null);
    }
  };

  const runBFlow = async () => {
    if (isBAutoRunning) return;
    setIsBAutoRunning(true);
    try {
      setBFlowError(null);
      setProviderResponses([]);
      setBFlowSteps((prev) =>
        prev.map((step) => ({ ...step, status: "pending" }))
      );

      updateBStepStatus("provider-402", "running");
      const providerFirst = await callProvider(false);
      if (providerFirst) {
        setStepResults((prev) => [
          ...prev,
          {
            flow: "B",
            step: "触发 402",
            data: providerFirst.data,
            timestamp: Date.now(),
          },
        ]);
      }
      updateBStepStatus("provider-402", "success");

      updateBStepStatus("delegation-challenge", "running");
      const challengeResult = await createDelegationChallenge();
      if (!challengeResult?.challenge_token) {
        updateBStepStatus("delegation-challenge", "error");
        setBFlowError("生成委托失败");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "B",
          step: "生成委托",
          data: {
            delegation_message: challengeResult.delegation_message,
            challenge_token: challengeResult.challenge_token,
            auth_session_id: challengeResult.auth_session_id,
            auth_hash: challengeResult.auth_hash,
          },
          timestamp: Date.now(),
        },
      ]);
      updateBStepStatus("delegation-challenge", "success");

      updateBStepStatus("delegation-sign", "running");
      const signature = await signDelegation(
        challengeResult?.delegation_message ?? null
      );
      if (!signature) {
        updateBStepStatus("delegation-sign", "error");
        setBFlowError("签名委托失败或被拒绝");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "B",
          step: "签名委托",
          data: { signature, memo_tx: signature },
          timestamp: Date.now(),
        },
      ]);
      updateBStepStatus("delegation-sign", "success");

      updateBStepStatus("delegation-mint", "running");
      const delegationTokenResult = await mintDelegationToken(
        challengeResult?.challenge_token ?? null,
        signature
      );
      if (!delegationTokenResult) {
        updateBStepStatus("delegation-mint", "error");
        setBFlowError("委托验签失败");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "B",
          step: "委托验签",
          data: { delegation_token: delegationTokenResult },
          timestamp: Date.now(),
        },
      ]);
      updateBStepStatus("delegation-mint", "success");

      updateBStepStatus("waas-pay", "running");
      const hash = await handlePay();
      if (!hash) {
        updateBStepStatus("waas-pay", "error");
        setBFlowError("WaaS 支付失败或被拒绝");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "B",
          step: "WaaS 支付",
          data: { tx_hash: hash },
          timestamp: Date.now(),
        },
      ]);
      updateBStepStatus("waas-pay", "success");

      updateBStepStatus("receipt-mint", "running");
      const receiptResult = await mintReceipt(
        paymentIntentId,
        hash,
        null,
        delegationTokenResult
      );
      if (!receiptResult?.receipt) {
        updateBStepStatus("receipt-mint", "error");
        setBFlowError("生成 receipt 失败");
        return;
      }
      setStepResults((prev) => [
        ...prev,
        {
          flow: "B",
          step: "生成 receipt",
          data: {
            receipt: receiptResult.receipt,
            receipt_payload: receiptResult.receipt_payload ?? undefined,
          },
          timestamp: Date.now(),
        },
      ]);
      updateBStepStatus("receipt-mint", "success");

      updateBStepStatus("provider-access", "running");
      const providerSecond = await callProvider(true, receiptResult.receipt);
      if (providerSecond) {
        setStepResults((prev) => [
          ...prev,
          {
            flow: "B",
            step: "凭证放行",
            data: providerSecond.data,
            timestamp: Date.now(),
          },
        ]);
      }
      updateBStepStatus("provider-access", "success");
    } finally {
      setIsBAutoRunning(false);
    }
  };

  const runManualBStep = async (id: string) => {
    if (manualBStepRunning || isBAutoRunning) {
      return;
    }
    setManualBStepRunning(id);
    setBFlowError(null);
    updateBStepStatus(id, "running");
    try {
      let ok = false;
      switch (id) {
        case "provider-402": {
          const result = await callProvider(false);
          ok = Boolean(result);
          if (result) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "B",
                step: "触发 402",
                data: result.data,
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "delegation-challenge": {
          const result = await createDelegationChallenge();
          ok = Boolean(result?.challenge_token);
          if (result?.challenge_token) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "B",
                step: "生成委托",
                data: {
                  delegation_message: result.delegation_message,
                  challenge_token: result.challenge_token,
                  auth_session_id: result.auth_session_id,
                  auth_hash: result.auth_hash,
                },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "delegation-sign": {
          const signature = await signDelegation();
          ok = Boolean(signature);
          if (signature) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "B",
                step: "签名委托",
                data: { signature, memo_tx: signature },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "delegation-mint": {
          const token = await mintDelegationToken();
          ok = Boolean(token);
          if (token) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "B",
                step: "委托验签",
                data: { delegation_token: token },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "waas-pay": {
          const hash = await handlePay();
          ok = Boolean(hash);
          if (hash) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "B",
                step: "WaaS 支付",
                data: { tx_hash: hash },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "receipt-mint": {
          const receiptResult = await mintReceipt();
          ok = Boolean(receiptResult?.receipt);
          if (receiptResult?.receipt) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "B",
                step: "生成 receipt",
                data: {
                  receipt: receiptResult.receipt,
                  receipt_payload: receiptResult.receipt_payload ?? undefined,
                },
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        case "provider-access": {
          const result = await callProvider(true, receipt);
          ok = Boolean(result);
          if (result) {
            setStepResults((prev) => [
              ...prev,
              {
                flow: "B",
                step: "凭证放行",
                data: result.data,
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }
        default:
          ok = false;
      }
      if (!ok) {
        updateBStepStatus(id, "error");
        setBFlowError(`步骤失败：${id}`);
        return;
      }
      updateBStepStatus(id, "success");
    } finally {
      setManualBStepRunning(null);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-slate-900">A 流程（intent）</h4>
        <p className="mt-1 text-xs text-slate-500">
          一键串联 A 流程；每个节点也支持手动重试。
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          用户对单次支付意图签名，Billing 验签后签发 receipt。
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-7">
          <button
            onClick={runAFlow}
            disabled={isAutoRunning}
            className={cn(
              "rounded-full px-3 py-2 text-[11px] font-semibold transition-all",
              isAutoRunning
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-slate-900 text-white hover:bg-slate-800"
            )}
          >
            A) 一键流程
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-7">
          {aFlowSteps.map((step) => {
            const isDisabled = isAutoRunning || manualStepRunning === step.id;
            return (
              <button
                key={step.id}
                onClick={() => runManualStep(step.id)}
                disabled={isDisabled}
                className={cn(
                  "rounded-full px-3 py-2 text-[11px] font-semibold text-center w-full transition-all",
                  step.status === "pending" && "bg-slate-200 text-slate-400",
                  step.status === "running" && "bg-amber-200 text-amber-800",
                  step.status === "success" && "bg-emerald-500 text-white",
                  step.status === "error" && "bg-red-500 text-white",
                  isDisabled ? "cursor-not-allowed opacity-70" : "hover:opacity-90"
                )}
              >
                {step.label}
              </button>
            );
          })}
        </div>
        {aFlowError ? (
          <div className="mt-2 text-xs text-red-600">{aFlowError}</div>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-slate-900">B 流程（delegation）</h4>
        <p className="mt-1 text-xs text-slate-500">
          一键串联 B 流程；每个节点也支持手动重试。
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          用户一次性委托额度给 Agent，多次支付复用 delegation。
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-7">
          <button
            onClick={runBFlow}
            disabled={isBAutoRunning}
            className={cn(
              "rounded-full px-3 py-2 text-[11px] font-semibold transition-all",
              isBAutoRunning
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-slate-900 text-white hover:bg-slate-800"
            )}
          >
            B) 一键流程
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-7">
          {bFlowSteps.map((step) => {
            const isDisabled = isBAutoRunning || manualBStepRunning === step.id;
            return (
              <button
                key={step.id}
                onClick={() => runManualBStep(step.id)}
                disabled={isDisabled}
                className={cn(
                  "rounded-full px-3 py-2 text-[11px] font-semibold text-center w-full transition-all",
                  step.status === "pending" && "bg-slate-200 text-slate-400",
                  step.status === "running" && "bg-amber-200 text-amber-800",
                  step.status === "success" && "bg-emerald-500 text-white",
                  step.status === "error" && "bg-red-500 text-white",
                  isDisabled ? "cursor-not-allowed opacity-70" : "hover:opacity-90"
                )}
              >
                {step.label}
              </button>
            );
          })}
        </div>
        {bFlowError ? (
          <div className="mt-2 text-xs text-red-600">{bFlowError}</div>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-1 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-700">
              Step results
            </h4>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setResultTab("A")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold transition-all",
                  resultTab === "A"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                )}
              >
                A
              </button>
              <button
                onClick={() => setResultTab("B")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold transition-all",
                  resultTab === "B"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                )}
              >
                B
              </button>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            {stepResults.filter((entry) => entry.flow === resultTab).length ? (
              stepResults
                .filter((entry) => entry.flow === resultTab)
                .map((entry, index) => (
                <div
                  key={`${entry.timestamp}-${index}`}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-3"
                >
                  <div className="text-[11px] text-amber-700 mb-1">
                    #{index + 1} · Flow {entry.flow} · {entry.step}
                  </div>
                  {entry.data?.memo_tx ? (
                    <div className="mb-2 text-[11px] text-amber-800">
                      memo_tx: {String(entry.data.memo_tx)} · 已上链 memo
                    </div>
                  ) : null}
                  <pre className="max-h-40 overflow-auto rounded-lg bg-amber-100/70 p-2 text-[11px] text-amber-900">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
                No step results yet.
              </div>
            )}
          </div>

          <h4 className="mt-4 text-xs font-semibold text-slate-700">
            Provider response
          </h4>
          <div className="mt-2 space-y-3">
            {providerResponses.length ? (
              providerResponses.map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`}>
                  <div className="text-[11px] text-slate-500 mb-1">
                    #{index + 1} · status {entry.status} ·{" "}
                    {entry.withReceipt ? "with receipt" : "no receipt"}
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-xl bg-slate-950/90 p-3 text-[11px] text-slate-100">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                </div>
              ))
            ) : (
              <pre className="max-h-40 overflow-auto rounded-xl bg-slate-950/90 p-3 text-[11px] text-slate-100">
                {"No response yet."}
              </pre>
            )}
          </div>
          <h4 className="mt-4 text-xs font-semibold text-slate-700">
            Payment metadata
          </h4>
          <div className="mt-2 text-xs text-slate-600 space-y-2">
            <div>Wallet: {walletAddress || "Not connected"}</div>
            <div>Intent: {paymentIntentId ?? "-"}</div>
            <div>Tx hash: {txHash ?? "-"}</div>
            <div>Auth session: {authSessionId || "-"}</div>
            <div>
              Auth hash: {intentAuthHash ?? delegationAuthHash ?? "-"}
            </div>
            <div>
              Memo: {memoOnChain ? "已上链" : "未上链"}
              {memoExplorerLink ? (
                <a
                  href={memoExplorerLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-amber-600 hover:text-amber-500"
                >
                  View memo tx
                </a>
              ) : null}
            </div>
            <div>
              Auth:{" "}
              {intentAuthorizationToken
                ? "intent"
                : delegationToken
                  ? "delegation"
                  : "-"}
            </div>
            {explorerLink ? (
              <a
                href={explorerLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 hover:text-amber-500"
              >
                View transaction
              </a>
            ) : null}
            <div className="break-all">
              Receipt: {receipt ? `${receipt.slice(0, 32)}...` : "-"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl bg-[#5bb1e6] px-6 py-10">
        <div className="relative mx-auto max-w-2xl rounded-3xl bg-white px-8 pb-8 pt-10 text-slate-900 shadow-[0_30px_60px_rgba(15,23,42,0.25)]">
          <div
            className="absolute -top-4 left-0 right-0 h-8"
            style={{
              backgroundImage:
                "radial-gradient(circle at 16px 16px, #5bb1e6 16px, transparent 17px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="text-center text-[11px] uppercase tracking-[0.5em] text-slate-400">
            G R 8 · V I B E S
          </div>
          <div className="mt-2 text-center text-4xl font-bold tracking-tight">
            RECEIPT
          </div>
         

          

          <div className="mt-6 h-1 w-full bg-slate-900" />
          <div className="py-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Total
              </div>
              <div className="text-3xl font-semibold">
                {amountInput} {currency}
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>Finyx Provider</div>
              <div>#{paymentIntentId ?? "-"}</div>
              <div>{receiptIssuedAt}</div>
            </div>
          </div>
          <div className="h-1 w-full bg-slate-900" />

          <div className="mt-6 border-t border-dashed border-slate-200 pt-4 text-xs text-slate-600">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">
                  Wallet
                </div>
                <div className="mt-1 font-mono text-[11px]">
                  {walletAddress || "Not connected"}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">
                  Wallet Owner
                </div>
                <div className="mt-1 text-[11px]">
                  {wallet?.owner ?? "-"}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">
                  Chain
                </div>
                <div className="mt-1 text-[11px]">
                  {wallet?.chain ?? "unknown"}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">
                  Auth
                </div>
                <div className="mt-1 text-[11px]">
                  {intentAuthorizationToken
                    ? "intent"
                    : delegationToken
                      ? "delegation"
                      : "-"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center text-[11px] text-slate-400">
            {receipt ? "RECEIPT (JWT)" : "No receipt issued yet."}
          </div>
          {receipt ? (
            <div className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-600">
              <span className="font-mono break-all">{receipt}</span>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col items-center">
            <div className="text-[10px] uppercase tracking-[0.35em] text-center text-slate-400">
              QR Code
            </div>
            {receiptQrDataUrl ? (
              <img
                src={receiptQrDataUrl}
                alt="Receipt QR code"
                className="mt-2 h-36 w-36 rounded-xl border border-slate-200 bg-white p-2"
              />
            ) : (
              <div className="mt-2 h-36 w-36 rounded-xl border border-slate-200 bg-slate-200" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
