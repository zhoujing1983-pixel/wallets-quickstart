"use client";

import { useAuth } from "@crossmint/client-sdk-react-ui";
import Image from "next/image";

export function LogoutButton() {
  const { logout } = useAuth();

  return (
    <button
      className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-[#041126] bg-white/90 border border-white/60 shadow-lg transition hover:bg-white"
      onClick={logout}
    >
      Log out
      <Image src="/log-out.svg" alt="Logout" width={16} height={16} />
    </button>
  );
}
