"use client";

import { Info } from "lucide-react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./performance.module.css";

export function ReportHelp({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  function show() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, window.innerWidth * 0.75);
    setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 180)) });
    setOpen(true);
  }
  return <span className={styles.help} data-report-help onMouseEnter={show} onMouseLeave={() => { if (document.activeElement !== trigger.current) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open} onFocus={show} onBlur={() => setOpen(false)} onClick={show} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}><Info size={15} aria-hidden="true" /></button>
    {open ? createPortal(<span id={id} role="tooltip" className={styles.helpText} style={{ position: "fixed", ...position, zIndex: 100 }}>{text}</span>, document.body) : null}
  </span>;
}
