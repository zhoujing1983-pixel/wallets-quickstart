import crypto from "crypto";

type VerifyResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string };

const base64UrlEncode = (input: Buffer | string) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const base64UrlDecode = (input: string) => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = padded.length % 4 ? 4 - (padded.length % 4) : 0;
  const base64 = padded + "=".repeat(padLength);
  return Buffer.from(base64, "base64").toString("utf8");
};

export const signToken = <T extends object>(payload: T, secret: string) => {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${headerPart}.${payloadPart}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64");
  const signaturePart = base64UrlEncode(Buffer.from(signature, "base64"));
  return `${unsigned}.${signaturePart}`;
};

export const verifyToken = <T extends object>(
  token: string,
  secret: string
): VerifyResult<T> => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "malformed_token" };
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const unsigned = `${headerPart}.${payloadPart}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64");
  const expectedSignaturePart = base64UrlEncode(
    Buffer.from(expectedSignature, "base64")
  );

  if (signaturePart !== expectedSignaturePart) {
    return { ok: false, error: "invalid_signature" };
  }

  let payload: T;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart)) as T;
  } catch {
    return { ok: false, error: "invalid_payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    payload &&
    typeof payload === "object" &&
    "exp" in payload &&
    typeof (payload as { exp?: number }).exp === "number" &&
    now > (payload as { exp: number }).exp
  ) {
    return { ok: false, error: "expired" };
  }

  return { ok: true, payload };
};

export type { VerifyResult };
