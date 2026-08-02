"use client";

import { useLayoutEffect, useRef } from "react";

const overlayOwners = new Set<symbol>();
let previousOverflow: { body: string; documentElement: string } | null = null;

function syncScrollLock() {
  const root = document.documentElement;
  if (overlayOwners.size > 0) {
    if (!previousOverflow) {
      previousOverflow = { body: document.body.style.overflow, documentElement: root.style.overflow };
    }
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return;
  }
  if (!previousOverflow) return;
  document.body.style.overflow = previousOverflow.body;
  root.style.overflow = previousOverflow.documentElement;
  previousOverflow = null;
}

export function useOverlayScrollLock(open: boolean) {
  const ownerRef = useRef<symbol>();

  useLayoutEffect(() => {
    if (!open) return;
    const owner = ownerRef.current ?? Symbol("overlay-scroll-lock");
    ownerRef.current = owner;
    overlayOwners.add(owner);
    syncScrollLock();

    return () => {
      overlayOwners.delete(owner);
      syncScrollLock();
    };
  }, [open]);
}
