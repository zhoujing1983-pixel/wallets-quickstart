import Image from "next/image";

export function Footer() {
  return (
    <footer className="flex flex-col gap-2 items-center justify-center py-4 mt-auto">
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-semibold uppercase tracking-[0.5em] text-slate-500">
          Finyx WaaS Studio
        </span>
      </div>
    </footer>
  );
}
