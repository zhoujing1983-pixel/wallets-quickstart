"use client";

import { FinyxProviders } from "@/app/finyx-providers";

export default function FinyxLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <FinyxProviders>{children}</FinyxProviders>;
}
