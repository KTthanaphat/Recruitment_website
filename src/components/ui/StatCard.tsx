import type { ReactNode } from "react";

type StatTone = "neutral" | "pressure" | "active" | "success" | "risk";

const tones: Record<StatTone, { card: string; icon: string; value: string; accent?: string }> = {
  neutral: { card: "bg-white", icon: "text-slate", value: "text-navy" },
  pressure: { card: "bg-[#FFFDF5]", icon: "text-[#8A5A00]", value: "text-[#8A5A00]", accent: "bg-amber" },
  active: { card: "bg-white", icon: "text-primary", value: "text-navy", accent: "bg-primary" },
  success: { card: "bg-[#F8FAFD]", icon: "text-primary", value: "text-primary", accent: "bg-primary" },
  risk: { card: "bg-[#FFF8F7]", icon: "text-[#B42318]", value: "text-[#B42318]", accent: "bg-scarlet" }
};

export function StatCard({ label, value, icon, tone = "neutral" }: { label: string; value: ReactNode; icon?: ReactNode; tone?: StatTone }) {
  const classes = tones[tone];
  return (
    <article className={`relative overflow-hidden rounded-lg border border-[#D7DEE8] p-4 shadow-[0_8px_20px_rgba(11,19,43,0.035)] ${classes.card}`}>
      {classes.accent ? <span className={`absolute inset-x-0 top-0 h-0.5 ${classes.accent}`} /> : null}
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate">{label}</span>
        {icon ? <span className={`rounded-md bg-[#F6F8FC] p-1.5 ${classes.icon}`}>{icon}</span> : null}
      </div>
      <strong className={`block font-semibold tracking-normal [font-variant-numeric:tabular-nums] ${classes.value}`}>{value}</strong>
    </article>
  );
}
