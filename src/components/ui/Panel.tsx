import type { ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-[#D7DEE8] bg-white p-5 shadow-panel ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({
  title,
  action,
  eyebrow
}: {
  title: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        {eyebrow ? <p className="mb-1 text-xs font-extrabold uppercase tracking-normal text-slate">{eyebrow}</p> : null}
        <h3 className="text-lg font-extrabold tracking-normal text-navy">{title}</h3>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
