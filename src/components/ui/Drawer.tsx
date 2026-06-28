"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function Drawer({
  open,
  eyebrow,
  title,
  children,
  onClose
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy/45">
      <aside className="h-full w-full overflow-y-auto bg-white shadow-2xl sm:max-w-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#D7DEE8] bg-white px-5 py-4">
          <div>
            <p className="mb-1 text-xs font-extrabold uppercase tracking-normal text-slate">{eyebrow}</p>
            <h3 className="text-xl font-extrabold text-navy">{title}</h3>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close" icon={<X size={18} />} />
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </aside>
    </div>
  );
}
