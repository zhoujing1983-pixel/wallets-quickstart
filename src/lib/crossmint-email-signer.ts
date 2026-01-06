import { IFrameWindow, SignersWindowTransport } from "@crossmint/client-sdk-window";
import {
  environmentUrlConfig,
  signerInboundEvents,
  signerOutboundEvents,
} from "@crossmint/client-signers";
import base58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";

export type SignerEnvironment = keyof typeof environmentUrlConfig;

type SignerWindow = IFrameWindow<
  typeof signerOutboundEvents,
  typeof signerInboundEvents
>;

let signerWindowPromise: Promise<SignerWindow> | null = null;
let signerWindowEnv: SignerEnvironment | null = null;

const resolveEnvironment = (env?: string): SignerEnvironment => {
  if (env === "production" || env === "staging" || env === "development") {
    return env;
  }
  return "staging";
};

const initSignerWindow = async (
  environment: SignerEnvironment
): Promise<SignerWindow> => {
  if (typeof window === "undefined") {
    throw new Error("Signer window is only available in the browser.");
  }
  if (signerWindowPromise && signerWindowEnv === environment) {
    return signerWindowPromise;
  }
  signerWindowEnv = environment;
  signerWindowPromise = (async () => {
    const iframeUrl = new URL(environmentUrlConfig[environment]);
    iframeUrl.searchParams.set("targetOrigin", window.location.origin);
    const iframe = document.createElement("iframe");
    iframe.src = iframeUrl.toString();
    Object.assign(iframe.style, {
      position: "absolute",
      opacity: "0",
      pointerEvents: "none",
      width: "0",
      height: "0",
      border: "none",
      top: "-9999px",
      left: "-9999px",
    });
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error("Failed to load signer iframe."));
      document.body.appendChild(iframe);
    });
    const signerWindow = await IFrameWindow.init(
      iframe,
      {
        targetOrigin: iframeUrl.origin,
        incomingEvents: signerOutboundEvents,
        outgoingEvents: signerInboundEvents,
      },
      SignersWindowTransport
    );
    await signerWindow.handshakeWithChild();
    return signerWindow;
  })();
  return signerWindowPromise;
};

const sendSignerAction = async <T>({
  environment,
  event,
  responseEvent,
  data,
}: {
  environment: SignerEnvironment;
  event: keyof typeof signerInboundEvents;
  responseEvent: keyof typeof signerOutboundEvents;
  data: Record<string, unknown>;
}): Promise<T> => {
  const signerWindow = await initSignerWindow(environment);
  return signerWindow.sendAction({
    event,
    responseEvent,
    data,
    options: {
      timeoutMs: 15000,
    },
  }) as Promise<T>;
};

export const getSignerStatus = async (params: {
  apiKey: string;
  jwt: string;
  environment?: string;
}) => {
  if (!params.jwt) {
    throw new Error("Missing Crossmint auth token.");
  }
  const environment = resolveEnvironment(params.environment);
  const response = await sendSignerAction<{
    status: "success" | "error";
    error?: string;
    signerStatus?: "ready" | "new-device";
  }>({
    environment,
    event: "request:get-status",
    responseEvent: "response:get-status",
    data: {
      authData: {
        jwt: params.jwt,
        apiKey: params.apiKey,
      },
    },
  });
  if (response.status === "error") {
    throw new Error(response.error || "Failed to fetch signer status.");
  }
  return response.signerStatus ?? "new-device";
};

export const sendEmailOtp = async (params: {
  apiKey: string;
  jwt: string;
  email: string;
  environment?: string;
}) => {
  if (!params.jwt) {
    throw new Error("Missing Crossmint auth token.");
  }
  const environment = resolveEnvironment(params.environment);
  const response = await sendSignerAction<{
    status: "success" | "error";
    error?: string;
    signerStatus?: "ready" | "new-device";
  }>({
    environment,
    event: "request:start-onboarding",
    responseEvent: "response:start-onboarding",
    data: {
      authData: {
        jwt: params.jwt,
        apiKey: params.apiKey,
      },
      data: {
        authId: `email:${params.email}`,
      },
    },
  });
  if (response.status === "error") {
    throw new Error(response.error || "Failed to send OTP.");
  }
  return response.signerStatus ?? "new-device";
};

export const verifyEmailOtp = async (params: {
  apiKey: string;
  jwt: string;
  otp: string;
  environment?: string;
}) => {
  if (!params.jwt) {
    throw new Error("Missing Crossmint auth token.");
  }
  const environment = resolveEnvironment(params.environment);
  const response = await sendSignerAction<{
    status: "success" | "error";
    error?: string;
    signerStatus?: "ready";
  }>({
    environment,
    event: "request:complete-onboarding",
    responseEvent: "response:complete-onboarding",
    data: {
      authData: {
        jwt: params.jwt,
        apiKey: params.apiKey,
      },
      data: {
        onboardingAuthentication: {
          encryptedOtp: params.otp,
        },
      },
    },
  });
  if (response.status === "error") {
    throw new Error(response.error || "Failed to verify OTP.");
  }
  return response.signerStatus ?? "ready";
};

export const signSolanaTransaction = async (params: {
  apiKey: string;
  jwt: string;
  transaction: string;
  environment?: string;
}) => {
  if (!params.jwt) {
    throw new Error("Missing Crossmint auth token.");
  }
  const environment = resolveEnvironment(params.environment);
  const transactionBytes = base58.decode(params.transaction);
  const deserializedTransaction = VersionedTransaction.deserialize(transactionBytes);
  const messageData = deserializedTransaction.message.serialize();
  const response = await sendSignerAction<{
    status: "success" | "error";
    error?: string;
    signature?: { bytes: string };
  }>({
    environment,
    event: "request:sign",
    responseEvent: "response:sign",
    data: {
      authData: {
        jwt: params.jwt,
        apiKey: params.apiKey,
      },
      data: {
        keyType: "ed25519",
        bytes: base58.encode(messageData),
        encoding: "base58",
      },
    },
  });
  if (response.status === "error") {
    throw new Error(response.error || "Failed to sign transaction.");
  }
  if (!response.signature?.bytes) {
    throw new Error("Signer did not return a signature.");
  }
  return response.signature.bytes;
};
