"use client";

import {
  CrossmintProvider,
  CrossmintAuthProvider,
  CrossmintWalletProvider,
} from "@crossmint/client-sdk-react-ui";

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

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CrossmintProvider apiKey={resolvedApiKey}>
      <CrossmintAuthProvider
        authModalTitle="Welcome to Finyx"
        loginMethods={["google", "email" , "farcaster", "twitter", "web3"]}
        appearance={customAppearance}
        termsOfServiceText={
          <p>
            By continuing, you accept the{" "}
            <a
              href="https://www.finyx.com/legal/terms-of-service"
              target="_blank"
              rel="noreferrer"
            >
              Wallet's Terms of Service
            </a>
            , and to receive updates from Finyx.
          </p>
        }
      >
        <CrossmintWalletProvider
          appearance={customAppearance}
          createOnLogin={{
            chain: chain,
            signer:{
              type: "email",
            
            // alias: "external-wallet-demo",
            // signer: {
            //   type: "external-wallet",
            //   address: "8eRQH6m65h27B17qPCS43biP3waFre1kQC9ZTteZZmMe",
            },
          }}
        >
          {children}
        </CrossmintWalletProvider>
      </CrossmintAuthProvider>
    </CrossmintProvider>
  );
}
