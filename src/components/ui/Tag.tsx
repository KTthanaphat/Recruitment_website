import type { ReactNode } from "react";

export type Tone = "primary" | "success" | "warning" | "danger" | "muted" | "teal" | "purple";

const tones: Record<Tone, string> = {
  primary: "bg-[color-mix(in_srgb,rgb(var(--app-primary-rgb))_88%,#00151F)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
  success: "bg-[color-mix(in_srgb,rgb(var(--app-primary-rgb))_88%,#00151F)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
  warning: "bg-[#e86800] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
  danger: "bg-[#ff2d55] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
  muted: "bg-[#7085a5] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
  teal: "bg-[#0099c7] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
  purple: "bg-[#9b4dff] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]"
};

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex min-h-6 items-center rounded-md px-2.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
