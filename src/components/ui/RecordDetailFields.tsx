"use client";
import { useState, type ReactNode } from "react";
import { Copy, CopyCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { translate } from "@/lib/i18n/dictionary";
import type { Language } from "@/types/recruitment";

type DetailGridRow = [string, string] | { label: string; value: string; copyValue?: string | null; icon?: ReactNode; action?: ReactNode };

export function DetailGrid({ rows, workspace = false, language = "en" }: { rows: DetailGridRow[]; workspace?: boolean; language?: Language }) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  async function copyValue(value: string, label: string) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopiedLabel(label);
      window.setTimeout(() => setCopiedLabel((current) => current === label ? null : current), 1500);
    } catch {
      setCopiedLabel(null);
    }
  }
  return (
    <div>
    <dl className={`grid min-w-0 gap-x-6 gap-y-0 ${workspace ? "sm:grid-cols-2" : "rounded-lg border border-[#D7DEE8] bg-lightgray p-4 sm:grid-cols-2"}`}>
      {rows.map((row, index) => {
        const item = Array.isArray(row) ? { label: row[0], value: row[1] } : row;
        const copyValueText = item.copyValue?.trim() || undefined;
        const copied = copiedLabel === item.label;
        return <div key={item.label} className={`min-w-0 ${workspace ? "grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-1.5 border-b border-[#E7EDF5] py-1.5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0" : ""}`}>
          {workspace ? <span className="grid size-9 place-items-center rounded-lg bg-[#F1F6FC] text-primary" aria-hidden="true">{item.icon ?? detailFieldGlyph(index)}</span> : null}
          <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-normal leading-tight text-slate">{item.label}</dt>
          <dd className="mt-px break-words text-sm font-semibold leading-tight text-navy">{item.value}</dd></div>
          {workspace ? item.action : null}
          {workspace && copyValueText ? <Button type="button" size="icon-sm" variant="ghost" className="text-slate hover:text-primary" icon={copied ? <CopyCheck size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} aria-label={copied ? translate(language, "copied") : translate(language, "copyValue", { label: item.label })} title={copied ? translate(language, "copied") : translate(language, "copyValue", { label: item.label })} onClick={() => void copyValue(copyValueText, item.label)} /> : null}
        </div>
      })}
    </dl>
      <p className="sr-only" aria-live="polite">{copiedLabel ? translate(language, "copied") : ""}</p>
    </div>
  );
}

function detailFieldGlyph(index: number) {
  const glyphs = ["☎", "✉", "◌", "◎", "▤", "▣", "⌂", "◉", "↪", "⌑"];
  return <span className="text-base leading-none">{glyphs[index] ?? "•"}</span>;
}

export function SectionHeading({ className = "", icon, title }: { className?: string; icon: ReactNode; title: string }) {
  return <h4 className={`inline-flex items-center gap-2 text-lg font-semibold text-navy ${className}`}><span className="text-primary" aria-hidden="true">{icon}</span>{title}</h4>;
}
