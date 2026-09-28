"use client";

import { Bookmark } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { detailUtilityClassName } from "@/components/ui/detail-utility";
import { translate } from "@/lib/i18n/dictionary";
import type { Language, Requisition } from "@/types/recruitment";

export function RequisitionPriorityButton({ requisition, language, canManage, onToggle }: {
  requisition: Requisition; language: Language; canManage: boolean;
  onToggle: (requisition: Requisition) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = translate(language, requisition.is_priority ? "removeRequisitionPriority" : "markRequisitionPriority");
  return <div className="relative">
    <Button type="button" variant="ghost" size="icon-sm" data-detail-utility className={detailUtilityClassName(Boolean(requisition.is_priority))}
      icon={<Bookmark size={18} fill={requisition.is_priority ? "currentColor" : "none"} aria-hidden="true" />}
      aria-label={label} title={canManage ? label : translate(language, "priorityReadOnly")}
      aria-pressed={Boolean(requisition.is_priority)} aria-busy={pending} disabled={pending || !canManage}
      onClick={async () => { if (pending || !canManage) return; setPending(true); setError(null); try { await onToggle(requisition); } catch { setError(translate(language, "prioritySaveFailed")); } finally { setPending(false); } }} />
    {error ? <p role="alert" className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-scarlet/30 bg-white p-3 text-sm text-scarlet shadow-md">{error}</p> : null}
  </div>;
}
