import type { ReactNode } from "react";

type PanelVariant = "default" | "section" | "subtle" | "report" | "workspace" | "primary" | "secondary" | "status";

const panelVariants: Record<PanelVariant, string> = {
  default: "border border-[#E4E9F2] bg-white p-5 shadow-[0_2px_8px_rgba(11,19,43,0.05)]",
  section: "border border-[#E4E9F2] bg-white p-5 shadow-[0_2px_8px_rgba(11,19,43,0.05)]",
  subtle: "border border-[#E4E9F2] bg-[#F8FAFD] p-4 shadow-none",
  report: "border border-[#C9D5E6] bg-white py-6 shadow-[0_14px_34px_rgba(11,19,43,0.06)]",
  workspace: "border border-[#C9D5E6] bg-white p-4 shadow-[0_8px_24px_rgba(11,19,43,0.055)] sm:p-5",
  primary: "border border-primary/25 bg-white p-4 shadow-[0_14px_34px_rgba(11,19,43,0.065)] sm:p-5",
  secondary: "border border-[#E4E9F2] bg-[#F8FAFD] p-4 shadow-none",
  status: "border border-[#C9D5E6] bg-[#F8FAFD] p-3 shadow-none"
};

export function Panel({ children, className = "", variant = "default" }: { children: ReactNode; className?: string; variant?: PanelVariant }) {
  return (
    <section className={`min-w-0 rounded-2xl ${panelVariants[variant]} ${className}`}>
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
        <h3 className="text-lg font-semibold leading-7 tracking-normal text-navy">{title}</h3>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
