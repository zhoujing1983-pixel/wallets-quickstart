"use client";

import { Suspense } from "react";
import { OnrampCheckout } from "@/components/onramp-checkout";

export default function OnrampPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0b1324] via-[#162046] to-[#ff7a18] px-4 py-10 flex items-center justify-center">
      <Suspense fallback={<div className="text-white/60">Loading...</div>}>
        <OnrampCheckout />
      </Suspense>
    </div>
  );
}
