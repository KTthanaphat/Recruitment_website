import type { ReactNode } from "react";

type StatTone = "neutral" | "pressure" | "active" | "success" | "risk";
type StatDensity = "default" | "compact";

const tones: Record<StatTone, { card: string; icon: string; value: string; accent?: string }> = {
  neutral: { card: "bg-white", icon: "text-slate", value: "text-navy" },
  pressure: { card: "bg-white", icon: "text-[#8A5A00]", value: "text-navy", accent: "bg-[#F3D3A2]" },
  active: { card: "bg-white", icon: "text-primary", value: "text-navy", accent: "bg-primary" },
  success: { card: "bg-white", icon: "text-primary", value: "text-navy", accent: "bg-[#C4D8FF]" },
  risk: { card: "bg-white", icon: "text-[#B42318]", value: "text-[#B42318]", accent: "bg-scarlet" }
};

export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  density = "default"
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  density?: StatDensity;
}) {
  const classes = tones[tone];
  return (
    <article className={`relative overflow-hidden rounded-2xl border border-[#E4E9F2] shadow-[0_2px_8px_rgba(11,19,43,0.05)] ${density === "compact" ? "p-3" : "p-5"} ${classes.card}`}>
      {classes.accent ? <span className={`absolute inset-x-0 top-0 h-0.5 ${classes.accent}`} /> : null}
      <div className={`${density === "compact" ? "mb-2" : "mb-3"} flex items-center justify-between gap-3`}>
        <span className="text-sm font-medium text-slate">{label}</span>
        {icon ? <span className={`rounded-xl border border-[#E4E9F2] bg-[#F8FAFD] p-2 ${classes.icon}`}>{icon}</span> : null}
      </div>
      <strong className={`block font-semibold tracking-normal [font-variant-numeric:tabular-nums] ${classes.value}`}>{value}</strong>
    </article>
  );
}
