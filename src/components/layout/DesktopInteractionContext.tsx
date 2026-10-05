"use client";

import { createContext, useContext, useEffect, useId } from "react";

export const DesktopInteractionContext = createContext<(id: string, active: boolean) => void>(() => {});

/** Keep an already-open editor/export mounted while the viewport becomes mobile. */
export function useDesktopInteractionLock(active: boolean) {
  const register = useContext(DesktopInteractionContext);
  const id = useId();
  useEffect(() => {
    register(id, active);
    return () => register(id, false);
  }, [id, active, register]);
}
