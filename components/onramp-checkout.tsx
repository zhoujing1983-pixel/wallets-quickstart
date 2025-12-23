"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CrossmintEmbeddedCheckout } from "@crossmint/client-sdk-react-ui";
import { useCrossmintOnramp } from "@/lib/useCrossmintOnramp";
import { cn } from "@/lib/utils";

const DEFAULT_AMOUNT = "10.00";
const FALLBACK_EMAIL = "demos+onramp-existing-user@crossmint.com";

type OnrampCheckoutProps = {
  onClose?: () => void;
  showReturnLink?: boolean;
  walletAddress?: string;
  receiptEmail?: string;
  initialAmount?: string;
  onPaymentSuccess?: () => void;
};

export function OnrampCheckout({
  onClose,
  showReturnLink = true,
  walletAddress: walletAddressProp,
  receiptEmail: receiptEmailProp,
  initialAmount: initialAmountProp,
  onPaymentSuccess,
}: OnrampCheckoutProps) {
  const searchParams = useSearchParams();
  const walletAddress =
    walletAddressProp ?? searchParams.get("walletAddress") ?? "";
  const initialAmount =
    initialAmountProp ?? searchParams.get("amount") ?? DEFAULT_AMOUNT;
  const receiptEmail =
    receiptEmailProp ?? searchParams.get("receiptEmail") ?? FALLBACK_EMAIL;

  const [amountUsd, setAmountUsd] = useState(initialAmount);
  const hasReportedSuccess = useRef(false);

  useEffect(() => {
    setAmountUsd(initialAmount);
  }, [initialAmount]);

  useEffect(() => {
    console.log("[onramp] OnrampCheckout mounted", {
      walletAddress,
      receiptEmail,
      initialAmount,
    });
  }, [initialAmount, receiptEmail, walletAddress]);

  useEffect(() => {
    if (!onPaymentSuccess) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith("crossmint.com")) {
        return;
      }
      const payload = event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }

      const eventName =
        "event" in payload && typeof payload.event === "string"
          ? payload.event
          : "type" in payload && typeof payload.type === "string"
            ? payload.type
            : "data" in payload &&
                payload.data &&
                typeof payload.data === "object" &&
                "event" in payload.data &&
                typeof payload.data.event === "string"
              ? payload.data.event
              : "event" in payload &&
                  payload.event &&
                  typeof payload.event === "object" &&
                  "type" in payload.event &&
                  typeof payload.event.type === "string"
                ? payload.event.type
                : null;

      if (!eventName || hasReportedSuccess.current) {
        return;
      }

      const successEvents = new Set([
        "payment:process.succeeded",
        "transaction:fulfillment.succeeded",
        "order:process.finished",
      ]);

      if (successEvents.has(eventName)) {
        hasReportedSuccess.current = true;
        onPaymentSuccess();
        return;
      }

      if (eventName === "order:updated") {
        const orderPayload =
          "data" in payload && payload.data && typeof payload.data === "object"
            ? payload.data
            : null;
        const paymentStatus =
          orderPayload &&
          "order" in orderPayload &&
          orderPayload.order &&
          typeof orderPayload.order === "object" &&
          "payment" in orderPayload.order &&
          orderPayload.order.payment &&
          typeof orderPayload.order.payment === "object" &&
          "status" in orderPayload.order.payment &&
          typeof orderPayload.order.payment.status === "string"
            ? orderPayload.order.payment.status
            : null;
        const orderStatus =
          orderPayload &&
          "order" in orderPayload &&
          orderPayload.order &&
          typeof orderPayload.order === "object" &&
          "status" in orderPayload.order &&
          typeof orderPayload.order.status === "string"
            ? orderPayload.order.status
            : null;
        const completionStatuses = new Set([
          "completed",
          "complete",
          "succeeded",
          "paid",
          "fulfilled",
        ]);
        if (
          (paymentStatus && completionStatuses.has(paymentStatus)) ||
          (orderStatus && completionStatuses.has(orderStatus))
        ) {
          hasReportedSuccess.current = true;
          onPaymentSuccess();
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [onPaymentSuccess]);

  const { order, createOrder, orderId, clientSecret, resetOrder } =
    useCrossmintOnramp({
      email: receiptEmail,
      walletAddress,
    });

  const isCreatingOrder = order.status === "creating-order";
  const isCheckoutReady = Boolean(orderId && clientSecret);
  const isMissingWallet = !walletAddress;

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    if (typeof window !== "undefined") {
      window.close();
    }
  };

  return (
    <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b1324] text-white shadow-[0_30px_80px_rgba(3,7,18,0.45)]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <div>
          <h1 className="text-base font-semibold">Add money</h1>
          <p className="text-[11px] text-white/60">
            Complete the purchase in this window.
          </p>
          <p className="mt-2 text-[10px] text-white/50">
            * For compliance reasons. This email is used by Crossmint to
            determine whether KYC is required for the order.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showReturnLink ? (
            <a
              href="/"
              className="text-[11px] font-semibold text-white/70 hover:text-white"
            >
              Return
            </a>
          ) : null}
          <button
            onClick={handleClose}
            className="text-[11px] font-semibold text-white/70 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {isMissingWallet ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/80">
            Wallet address missing. Please open this window from the wallet
            dashboard.
          </div>
        ) : orderId == null ? (
          <>
            <div>
              <p className="text-xs font-semibold">Deposit</p>
              <p className="text-[11px] text-white/60">
                Create a Crossmint onramp order for your wallet.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold text-white/70">$</span>
              <input
                type="number"
                min="1"
                step="1"
                value={amountUsd}
                onChange={(event) => setAmountUsd(event.target.value)}
                className="w-full rounded-xl bg-white/10 px-3 py-2 text-base font-semibold text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
              />
            </div>
            {order.status === "error" && order.error && (
              <p className="text-[11px] text-red-200">{order.error}</p>
            )}
            <button
              onClick={() => {
                console.log("[onramp] Continue clicked", {
                  walletAddress,
                  receiptEmail,
                  amountUsd,
                });
                if (!amountUsd || Number(amountUsd) <= 0) {
                  alert("Enter a valid amount");
                  return;
                }
                createOrder(amountUsd);
              }}
              disabled={isCreatingOrder}
              className={cn(
                "w-full py-2 rounded-full text-xs font-semibold transition-all duration-200",
                isCreatingOrder
                  ? "bg-white/20 text-white/60 cursor-not-allowed"
                  : "bg-white text-[#041126] hover:opacity-90"
              )}
            >
              {isCreatingOrder ? "Creating order..." : "Continue"}
            </button>
            {order.totalUsd && order.effectiveAmount && (
              <p className="text-[11px] text-white/60">
                Estimated total ${order.totalUsd}. You will receive at least{" "}
                {order.effectiveAmount} USDC.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="text-[11px] text-white/60 text-center">
              Use test card 4242 4242 4242 4242 to complete checkout.
            </div>
            {isCheckoutReady && (
              <div className="bg-white rounded-2xl p-3">
                <CrossmintEmbeddedCheckout
                  orderId={orderId}
                  // @ts-ignore clientSecret is required by the SDK
                  clientSecret={clientSecret}
                  payment={{
                    receiptEmail,
                    crypto: { enabled: false },
                    fiat: { enabled: true },
                    defaultMethod: "fiat",
                  }}
                />
              </div>
            )}
            <button
              onClick={() => resetOrder()}
              className="w-full py-2 rounded-full text-[11px] font-semibold text-white/80 border border-white/20 hover:text-white transition"
            >
              Start a new order
            </button>
          </>
        )}
      </div>
    </div>
  );
}
