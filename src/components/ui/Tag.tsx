import type { ReactNode } from "react";

export type Tone = "primary" | "success" | "warning" | "danger" | "muted" | "teal" | "purple";

const tones: Record<Tone, string> = {
  primary: "bg-white text-primary ring-1 ring-inset ring-[#C9D5E6]",
  success: "bg-white text-primary ring-1 ring-inset ring-[#C9D5E6]",
  warning: "bg-[#FFFDF5] text-[#8A5A00] ring-1 ring-inset ring-[#F3D3A2]",
  danger: "bg-[#FFF8F7] text-[#B42318] ring-1 ring-inset ring-[#F4B4AE]",
  muted: "bg-[#F6F8FC] text-slate ring-1 ring-inset ring-[#D7DEE8]",
  teal: "bg-[#F6F8FC] text-slate ring-1 ring-inset ring-[#D7DEE8]",
  purple: "bg-[#F6F8FC] text-slate ring-1 ring-inset ring-[#D7DEE8]"
};

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex min-h-6 items-center rounded-md px-2.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
