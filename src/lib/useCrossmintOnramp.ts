"use client";

import { useCallback, useState } from "react";
import { CreateOrderResponse, ApiErrorResponse } from "@/types/types";

export type OnrampStatus =
  | "not-created"
  | "creating-order"
  | "awaiting-payment"
  | "error";

type UseCrossmintOnrampArgs = {
  email: string;
  walletAddress: string;
};

export function useCrossmintOnramp({
  email,
  walletAddress,
}: UseCrossmintOnrampArgs) {
  const [status, setStatus] = useState<OnrampStatus>("not-created");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalUsd, setTotalUsd] = useState<string | null>(null);
  const [effectiveAmount, setEffectiveAmount] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const createOrder = useCallback(
    async (amountUsd: string) => {
      setStatus("creating-order");
      setError(null);
      const endpoint =
        typeof window !== "undefined"
          ? `${window.location.origin}/api/orders`
          : "/api/orders";
      console.log("[onramp sending to crossmint] POST", endpoint, {
        headers: { "Content-Type": "application/json" },
        body: {
          amount: amountUsd,
          receiptEmail: email,
          walletAddress,
        },
      });
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountUsd,
          receiptEmail: email,
          walletAddress,
        }),
      });
      const data: CreateOrderResponse | ApiErrorResponse = await res.json();
      if (!res.ok) {
        const errorDetails = (data as ApiErrorResponse).details as
          | { message?: string }
          | undefined;
        const errorMessage =
          typeof errorDetails?.message === "string"
            ? errorDetails.message
            : (data as ApiErrorResponse).error;
        setError(errorMessage ?? "Failed to create order");
        setStatus("error");
        return;
      }

      const orderData = data as CreateOrderResponse;
      setOrderId(orderData.order.orderId);
      setClientSecret(orderData.clientSecret);

      const total = orderData.order.quote.totalPrice.amount;
      const lineItem = orderData.order.lineItems[0];
      const effective = lineItem.quote.quantityRange.lowerBound;
      setTotalUsd(total);
      setEffectiveAmount(effective);

      setStatus("awaiting-payment");
    },
    [email, walletAddress]
  );

  const resetOrder = useCallback(() => {
    setStatus("not-created");
    setOrderId(null);
    setError(null);
    setTotalUsd(null);
    setEffectiveAmount(null);
    setClientSecret(null);
  }, []);

  return {
    order: {
      status,
      error,
      totalUsd,
      effectiveAmount,
    },
    orderId,
    clientSecret,
    createOrder,
    resetOrder,
  } as const;
}
