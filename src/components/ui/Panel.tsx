import type { ReactNode } from "react";

type PanelVariant = "default" | "section" | "subtle" | "report";

const panelVariants: Record<PanelVariant, string> = {
  default: "border border-[#D7DEE8] bg-white p-5 shadow-[0_8px_22px_rgba(11,19,43,0.035)]",
  section: "border border-[#C9D5E6] bg-white p-5 shadow-[0_10px_24px_rgba(11,19,43,0.045)]",
  subtle: "border border-[#D7DEE8] bg-[#F8FAFD] p-4 shadow-none",
  report: "border border-[#D7DEE8] bg-white py-6 shadow-[0_8px_22px_rgba(11,19,43,0.035)]"
};

export function Panel({ children, className = "", variant = "default" }: { children: ReactNode; className?: string; variant?: PanelVariant }) {
  return (
    <section className={`min-w-0 rounded-lg ${panelVariants[variant]} ${className}`}>
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
        {eyebrow ? <p className="mb-1 text-xs font-medium uppercase tracking-normal text-slate">{eyebrow}</p> : null}
        <h3 className="text-lg font-semibold tracking-normal text-navy">{title}</h3>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
