"use client";

import { useMemo } from "react";

type WalletItem = {
  id: string;
  name: string;
  icon: string;
  installed: boolean;
  tag?: string;
  onClick: () => void;
};

type FinyxWalletPickerProps = {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  isConnecting: boolean;
  error: string | null;
  wallets: WalletItem[];
};

export function FinyxWalletPicker({
  open,
  onClose,
  onBack,
  isConnecting,
  error,
  wallets,
}: FinyxWalletPickerProps) {
  const list = useMemo(() => wallets, [wallets]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8">
      <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_28px_110px_rgba(15,23,42,0.25)]">
        <div className="flex items-center justify-between text-slate-600">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full p-2 transition hover:bg-slate-100"
            aria-label="Back"
          >
            ←
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 transition hover:bg-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-2">
          <h3 className="text-lg font-semibold text-slate-900">
            Log in or sign up
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Connect a wallet to continue.
          </p>
        </div>

        <div className="mt-6">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-400">
            <span>🔍</span>
            <span>Search wallets...</span>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {list.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              onClick={wallet.onClick}
              disabled={isConnecting}
              className="flex w-full items-center justify-between rounded-2xl px-2 py-2 transition hover:bg-slate-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                  <img
                    src={wallet.icon}
                    alt={`${wallet.name} logo`}
                    className="h-5 w-5"
                    loading="lazy"
                  />
                </span>
                <span className="text-base font-semibold text-slate-900">
                  {wallet.name}
                </span>
              </div>
              <span className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {wallet.installed ? "Installed" : "Not installed"}
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
