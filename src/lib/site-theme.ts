import type { CSSProperties } from "react";

type SiteAccent = {
  base: string;
  hover: string;
  rgb: string;
  strong: string;
  strongRgb: string;
};

const fallbackAccent: SiteAccent = {
  base: "#0A3CDC",
  hover: "#082BB0",
  rgb: "10 60 220",
  strong: "#082BB0",
  strongRgb: "8 43 176"
};

const siteAccents: Record<string, SiteAccent> = {
  HQ: {
    base: "#0AA0C3",
    hover: "#087A92",
    rgb: "10 160 195",
    strong: "#087A92",
    strongRgb: "8 122 146"
  },
  KT1: {
    base: "#146EFA",
    hover: "#0F4FC4",
    rgb: "20 110 250",
    strong: "#0F4FC4",
    strongRgb: "15 79 196"
  },
  KT2: {
    base: "#411EDC",
    hover: "#351AAE",
    rgb: "65 30 220",
    strong: "#351AAE",
    strongRgb: "53 26 174"
  }
};

export function siteAccent(site: string | null | undefined) {
  const key = String(site ?? "").trim().toUpperCase();
  return siteAccents[key] ?? fallbackAccent;
}

export function siteAccentStyle(site: string | null | undefined): CSSProperties {
  const accent = siteAccent(site);
  return {
    "--app-primary": accent.base,
    "--app-primary-hover": accent.hover,
    "--app-primary-rgb": accent.rgb,
    "--app-primary-strong": accent.strong,
    "--app-primary-strong-rgb": accent.strongRgb
  } as CSSProperties;
}
