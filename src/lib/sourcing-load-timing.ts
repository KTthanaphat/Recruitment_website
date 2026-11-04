import { useEffect } from "react";
import type { RecruitmentReadPhases } from "./recruitment-list";

/** Numeric phases only: no scope, record identifiers, request bodies, or row data. */
export function useSourcingDisplayTiming(view: "board" | "history" | "selected-week", timing?: RecruitmentReadPhases) {
  useEffect(() => {
    if (!timing || typeof window === "undefined") return;
    let paint = 0;
    const frame = requestAnimationFrame(() => {
      paint = requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("recruitment:sourcing-display", { detail: {
          view, cacheHit: timing.cacheHit, queueMs: timing.queueMs, requestMs: timing.requestMs,
          responseToDisplayMs: performance.now() - timing.receivedAt
        } }));
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(paint); };
  }, [view, timing]);
}
