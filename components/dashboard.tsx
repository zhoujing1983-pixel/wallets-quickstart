import { useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import Image from "next/image";
import { TransferFunds } from "./transfer";
import { Activity } from "./activity";
import { Footer } from "./footer";
import { LogoutButton } from "./logout";
import { WalletBalance } from "./balance";

export function Dashboard() {
  const { wallet } = useWallet();
  const [copiedAddress, setCopiedAddress] = useState(false);

  const walletAddress = wallet?.address;

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full max-w-6xl mx-auto px-4 py-10 flex flex-col gap-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-4">
              <Image
                src="/finyx.svg"
                alt="Finyx logo"
                priority
                width={160}
                height={60}
                className="h-12 w-auto"
              />
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                  Wallet Studio
                </p>
                <h1 className="text-3xl font-semibold text-slate-900">
                  Designed for the Finyx community
                </h1>
              </div>
            </div>
            <div className="text-right text-sm text-slate-500">
              <p className="text-slate-400">Connected chain</p>
              <p className="text-lg font-semibold text-slate-900">
                {wallet?.chain ?? "Unknown"}
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            Finyx Wallet Studio wraps Crossmint's wallet primitives with bright
            gradients, bold typography, and frictionless flows.
          </p>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Dashboard</h2>
              <p className="text-sm text-slate-500">
                Wallet overview and instant actions
              </p>
            </div>
            <LogoutButton />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="flex flex-col gap-6">
            <div className="bg-[#1c2c56] border border-white/15 p-6 rounded-3xl shadow-lg">
                <WalletBalance />
              </div>
            <div className="bg-[#1c2c56] border border-white/15 p-6 rounded-3xl shadow-lg space-y-4">
                <h3 className="text-lg font-semibold text-white">Wallet details</h3>
                <div className="flex flex-col gap-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Address</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-100">
                        {walletAddress
                          ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-6)}`
                          : "Not connected"}
                      </span>
                      <button
                        onClick={handleCopyAddress}
                        className="text-slate-300 hover:text-white transition"
                      >
                        {copiedAddress ? (
                          <Image
                            src="/circle-check-big.svg"
                            alt="Copied"
                            width={16}
                            height={16}
                          />
                        ) : (
                          <Image src="/copy.svg" alt="Copy" width={16} height={16} />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Owner</span>
                    <span className="text-slate-100">
                      {wallet?.owner?.replace(/^[^:]*:/, "") || "Current User"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Chain</span>
                    <span className="text-slate-100 capitalize">
                      {wallet?.chain ?? "Unknown"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="lg:col-span-1">
              <TransferFunds />
            </div>
            <div className="lg:col-span-1">
              <Activity />
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  );
}
