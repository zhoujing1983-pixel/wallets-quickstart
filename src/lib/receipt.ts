import { signToken, verifyToken } from "@/lib/hmac-token";

type ReceiptPayload = {
  iss: string;
  sub: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  amount: string;
  currency: string;
  chain_id: string;
  tx_hash: string;
  payment_intent_id: string;
  scope: string;
  authorization_type?: "intent" | "delegation";
  auth_method?: string;
  auth_session_id?: string;
  auth_hash?: string;
};

export const signReceipt = (payload: ReceiptPayload, secret: string) => {
  return signToken(payload, secret);
};

export const verifyReceipt = (token: string, secret: string) => {
  const result = verifyToken<ReceiptPayload>(token, secret);
  if (!result.ok) {
    return result;
  }
  return { ok: true, payload: result.payload } as const;
};

export type { ReceiptPayload };
