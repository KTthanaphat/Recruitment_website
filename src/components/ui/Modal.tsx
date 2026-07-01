"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function Modal({
  open,
  title,
  children,
  onClose,
  width = "max-w-3xl"
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-stretch bg-navy/45 p-0 sm:place-items-center sm:p-4">
      <div className={`max-h-screen w-full overflow-y-auto overscroll-contain bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-lg ${width}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#D7DEE8] bg-white px-5 py-4">
          <h3 className="text-lg font-extrabold text-navy">{title}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close" icon={<X size={18} />} />
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
