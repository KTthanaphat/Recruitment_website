"use client";

import { useEffect, useState } from "react";
import type { ViewId } from "@/types/recruitment";

export type LayoutMode = "unknown" | "mobile" | "desktop";
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
export const DESKTOP_ONLY_VIEWS: readonly ViewId[] = ["dashboard", "configuration", "audit", "admin"];

export function isDesktopOnlyView(view: ViewId) {
  return DESKTOP_ONLY_VIEWS.includes(view);
}

export function isViewAvailable(view: ViewId, mode: LayoutMode) {
  return mode !== "unknown" && (mode === "desktop" || !isDesktopOnlyView(view));
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>("unknown");
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => setMode(query.matches ? "desktop" : "mobile");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mode;
}
