"use client";

import {
  CrossmintProvider,
  CrossmintAuthProvider,
  CrossmintWalletProvider,
} from "@crossmint/client-sdk-react-ui";
import type { LoginMethod } from "@crossmint/client-sdk-react-ui";

const apiKey =
  process.env.NEXT_PUBLIC_FINYX_API_KEY ??
  process.env.NEXT_PUBLIC_CROSSMINT_API_KEY;

if (!apiKey) {
  throw new Error(
    "NEXT_PUBLIC_FINYX_API_KEY (or the legacy NEXT_PUBLIC_CROSSMINT_API_KEY) is not set"
  );
}
const resolvedApiKey = apiKey;

const chain = (process.env.NEXT_PUBLIC_CHAIN ?? "solana") as any;

const customAppearance = {
  colors: {
    accent: "#020617",
  },
};
const loginMethods: LoginMethod[] = ["google", "twitter", "web3", "email"];
const termsOfServiceText = (
  <p>
    By continuing, you accept the{" "}
    <a
      href="https://www.finyx.com/legal/terms-of-service"
      target="_blank"
      rel="noreferrer"
    >
      Wallet&apos;s Terms of Service
    </a>
    , and to receive updates from Finyx.
  </p>
);


export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CrossmintProvider apiKey={resolvedApiKey}>
      <CrossmintAuthProvider
        authModalTitle="Welcome to Finyx"
        loginMethods={loginMethods}
        appearance={customAppearance}
        termsOfServiceText={termsOfServiceText}
      >
        <CrossmintWalletProvider
          appearance={customAppearance}
           createOnLogin={{
            chain: chain,
            signer: {
              type: "email",
            },
          }}
        >
          {children}
        </CrossmintWalletProvider>
      </CrossmintAuthProvider>
    </CrossmintProvider>
  );
}
