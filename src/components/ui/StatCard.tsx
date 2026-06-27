import type { ReactNode } from "react";

export function StatCard({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <article className="rounded-lg border border-[#D7DEE8] bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-slate">{label}</span>
        {icon ? <span className="text-primary">{icon}</span> : null}
      </div>
      <strong className="block text-3xl font-extrabold tracking-normal text-primary">{value}</strong>
    </article>
  );
}
