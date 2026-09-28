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

const softTones: Record<Tone, string> = {
  primary: "bg-[#E8F0FF] text-primary",
  success: "bg-[#E9F9EF] text-[#167A3D]",
  warning: "bg-[#FFF4D8] text-[#A96300]",
  danger: "bg-[#FFF0F1] text-[#C52B40]",
  muted: "bg-[#EEF2F7] text-slate",
  teal: "bg-[#E7F7FA] text-[#08758A]",
  purple: "bg-[#F3EAFF] text-[#7040A8]"
};

export function Tag({ children, tone = "muted", appearance = "filled" }: { children: ReactNode; tone?: Tone; appearance?: "filled" | "soft" }) {
  return <span data-tag-appearance={appearance} className={`inline-flex min-h-6 items-center rounded-md px-2.5 text-xs font-semibold ${appearance === "soft" ? softTones[tone] : tones[tone]}`}>{children}</span>;
}
