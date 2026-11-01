"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Language } from "@/types/recruitment";
import type { ReasonCount } from "@/lib/rejection-report";
import { layoutReasonTreemap } from "@/lib/rejection-treemap";
import { rejectionText } from "./rejection-copy";
import styles from "./rejections.module.css";
function reasonColor(row: ReasonCount) {
  let hash = 0; for (const char of row.key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${row.actor === "company" ? 348 : 215} ${row.actor === "unclassified" ? 16 : 49}% ${34 + hash % 10}%)`;
}
export function ReasonTreemap({ reasons, language, selected, onSelect, exportMode = false }: {
  reasons: ReasonCount[]; language: Language; selected: string; onSelect: (key: string) => void; exportMode?: boolean;
}) {
  const t = rejectionText(language), ref = useRef<HTMLDivElement>(null), tooltipId = useId();
  const [size, setSize] = useState({ width: 1000, height: 280, measured: false });
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const surface = ref.current; if (!surface) return;
    const measure = () => { const box = surface.getBoundingClientRect(); if (box.width > 0 && box.height > 0) setSize(current => current.width === box.width && current.height === box.height && current.measured ? current : { width: box.width, height: box.height, measured: true }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(surface); return () => observer.disconnect();
  }, []);
  const rectangles = useMemo(() => layoutReasonTreemap(reasons, size.width, size.height), [reasons, size.width, size.height]);
  const byKey = useMemo(() => new Map(reasons.map(row => [row.key, row])), [reasons]);
  const describe = (row: ReasonCount) => `${row.label[language]} · ${t(row.actor)} · ${row.count} · ${(row.share * 100).toFixed(1)}% ${t("comparisonShare")}${selected === row.key ? ` · ${t("selected")}` : ""}`;
  const activeReason = active ? byKey.get(active) : undefined;
  return <div data-reason-treemap>
    <div className={styles.treemap} ref={ref} data-treemap-ready={size.measured ? "true" : "false"}>
      {rectangles.map(rect => { const row = byKey.get(rect.key)!; const labelFits = rect.width >= 125 && rect.height >= 62;
        return <button key={rect.key} type="button" className={styles.treemapCell} data-reason-cell={rect.key} aria-label={describe(row)} aria-pressed={selected === rect.key} aria-describedby={!exportMode && active === rect.key ? tooltipId : undefined} disabled={exportMode}
          style={{ left: `${rect.x / size.width * 100}%`, top: `${rect.y / size.height * 100}%`, width: `${rect.width / size.width * 100}%`, height: `${rect.height / size.height * 100}%`, backgroundColor: reasonColor(row) }}
          onClick={() => onSelect(rect.key)} onMouseEnter={() => setActive(rect.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(rect.key)} onBlur={() => setActive(null)}>
          {labelFits ? <><span className={styles.cellName}>{row.label[language]}</span><span className={styles.cellValue}>{row.count} · {(row.share * 100).toFixed(1)}%</span>{selected === rect.key ? <small>{t("selected")}</small> : null}</> : null}
        </button>;
      })}
      {!exportMode && activeReason ? <div id={tooltipId} role="tooltip" className={styles.treemapTooltip}>{describe(activeReason)}</div> : null}
    </div>
    <details className={styles.reasonDirectory} open={exportMode || undefined}><summary>{t("smallReasons")} ({reasons.length})</summary>
      <ul>{reasons.map(row => <li key={row.key}><button type="button" disabled={exportMode} aria-pressed={selected === row.key} onClick={() => onSelect(row.key)}><span><i style={{ backgroundColor: reasonColor(row) }} />{row.label[language]}<small>{t(row.actor)}</small></span><strong>{row.count} · {(row.share * 100).toFixed(1)}%{selected === row.key ? ` · ${t("selected")}` : ""}</strong></button></li>)}</ul>
    </details>
  </div>;
}
