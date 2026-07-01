import type { ReactNode } from "react";

type StatTone = "neutral" | "pressure" | "active" | "success" | "risk";

const tones: Record<StatTone, { card: string; icon: string; value: string; accent: string }> = {
  neutral: { card: "bg-white", icon: "text-primary", value: "text-primary", accent: "bg-primary" },
  pressure: { card: "bg-[#FFF8E1]", icon: "text-[#8A5A00]", value: "text-[#8A5A00]", accent: "bg-amber" },
  active: { card: "bg-[#EEF4FF]", icon: "text-primary", value: "text-primary", accent: "bg-primary" },
  success: { card: "bg-[#E8FFF7]", icon: "text-[#007C63]", value: "text-[#007C63]", accent: "bg-emerald" },
  risk: { card: "bg-[#FFF1F0]", icon: "text-[#B42318]", value: "text-[#B42318]", accent: "bg-scarlet" }
};

export function StatCard({ label, value, icon, tone = "neutral" }: { label: string; value: ReactNode; icon?: ReactNode; tone?: StatTone }) {
  const classes = tones[tone];
  return (
    <article className={`relative overflow-hidden rounded-lg border border-[#D7DEE8] p-4 shadow-panel ${classes.card}`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${classes.accent}`} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-slate">{label}</span>
        {icon ? <span className={classes.icon}>{icon}</span> : null}
      </div>
      <strong className={`block text-3xl font-extrabold tracking-normal ${classes.value}`}>{value}</strong>
    </article>
  );
}
