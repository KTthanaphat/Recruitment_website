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
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/45 p-4">
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-lg bg-white shadow-2xl ${width}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#D7DEE8] bg-white px-5 py-4">
          <h3 className="text-lg font-extrabold text-navy">{title}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close" icon={<X size={18} />} />
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
