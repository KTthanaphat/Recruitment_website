"use client";
import { useId, useRef, useState, type ComponentProps } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Props = ComponentProps<typeof Button> & { loading?: boolean; context?: string };
export function RetryIconButton({ children, loading = false, disabled, context, title, className = "", onClick, ...props }: Props) {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipId = useId();
  const label = typeof children === "string" ? children : "Retry";
  const accessibleLabel = props["aria-label"] ?? (context ? `${label}: ${context}` : label);
  return <span className="relative inline-flex align-middle" onMouseEnter={() => setTooltipOpen(true)} onMouseLeave={() => setTooltipOpen(false)}><Button {...props} type="button" variant="ghost" size="icon-sm" className={`ats-retry-icon ${className}`} title={title ?? accessibleLabel} aria-label={accessibleLabel} aria-describedby={tooltipOpen ? tooltipId : undefined} onFocus={() => setTooltipOpen(true)} onBlur={() => setTooltipOpen(false)} aria-busy={loading || pending} disabled={disabled || loading || pending} onClick={event => {
    if (locked.current || loading || disabled) return;
    locked.current = true; setPending(true);
    try { const result: unknown = onClick?.(event); Promise.resolve(result).catch(() => undefined).finally(() => { locked.current = false; setPending(false); }); }
    catch { locked.current = false; setPending(false); }
  }}><RotateCw size={17} aria-hidden="true" className={loading || pending ? "motion-safe:animate-spin" : ""} /></Button>{tooltipOpen ? <span id={tooltipId} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-[90] mb-1 w-max max-w-56 -translate-x-1/2 rounded-md bg-navy px-2 py-1 text-xs font-normal text-white shadow-sm">{title ?? accessibleLabel}</span> : null}</span>;
}
