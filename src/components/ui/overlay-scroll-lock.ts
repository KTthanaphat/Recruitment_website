"use client";

import { useEffect } from "react";

let activeOverlayLocks = 0;
let previousBodyOverflow: string | null = null;

export function useOverlayScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;

    if (activeOverlayLocks === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeOverlayLocks += 1;

    return () => {
      activeOverlayLocks = Math.max(0, activeOverlayLocks - 1);
      if (activeOverlayLocks === 0) {
        document.body.style.overflow = previousBodyOverflow ?? "";
        previousBodyOverflow = null;
      }
    };
  }, [open]);
}
