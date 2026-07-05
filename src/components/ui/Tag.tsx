import type { ReactNode } from "react";

export type Tone = "primary" | "success" | "warning" | "danger" | "muted" | "teal" | "purple";

const tones: Record<Tone, string> = {
  primary: "bg-[#EEF4FF] text-primary",
  success: "bg-[#E8FFF7] text-[#007C63]",
  warning: "bg-[#FFF8E1] text-[#8A5A00]",
  danger: "bg-[#FFF1F0] text-[#B42318]",
  muted: "bg-lightgray text-slate",
  teal: "bg-[#E7F9FC] text-teal",
  purple: "bg-[#F0ECFF] text-purple"
};

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex min-h-6 items-center rounded-md px-2.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
