"use client";

import { useCallback, useEffect, useState } from "react";

export type WorkspaceUrlValues = Record<string, string | number | boolean | null | undefined>;

export type WorkspaceNavigationContext = {
  language?: string | null;
  site?: string | null;
  owner?: string | null;
  sourcingWeek?: string | null;
};

export function readWorkspaceUrlState() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function updateWorkspaceUrlState(values: WorkspaceUrlValues) {
  writeWorkspaceUrlState(values, "replace");
}

export function pushWorkspaceUrlState(values: WorkspaceUrlValues) {
  writeWorkspaceUrlState(values, "push");
}

export function buildContextualHref(path: string, context: WorkspaceNavigationContext) {
  const [pathname, existingQuery = ""] = path.split("?");
  const params = new URLSearchParams(existingQuery);
  setOptionalParam(params, "lang", context.language);
  setOptionalParam(params, "site", context.site);
  setOptionalParam(params, "pic", context.owner);
  setOptionalParam(params, "sourcingWeek", context.sourcingWeek);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function writeWorkspaceUrlState(values: WorkspaceUrlValues, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "" || value === false) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState(null, "", nextUrl);
  else window.history.replaceState(null, "", nextUrl);
  window.dispatchEvent(new Event("workspace:urlchange"));
}

function setOptionalParam(params: URLSearchParams, key: string, value: string | null | undefined) {
  if (value) params.set(key, value);
  else params.delete(key);
}

export function useWorkspaceUrlState() {
  const [params, setParams] = useState(() => readWorkspaceUrlState());

  useEffect(() => {
    const sync = () => setParams(readWorkspaceUrlState());
    window.addEventListener("popstate", sync);
    window.addEventListener("workspace:urlchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("workspace:urlchange", sync);
    };
  }, []);

  const read = useCallback(() => new URLSearchParams(params), [params]);
  const update = useCallback((values: WorkspaceUrlValues) => updateWorkspaceUrlState(values), []);
  const push = useCallback((values: WorkspaceUrlValues) => pushWorkspaceUrlState(values), []);
  return { params, push, read, update };
}
