"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

type BreadcrumbItem = {
  current?: boolean;
  href: string;
  label: string;
  onSelect?: () => void;
};

export function WorkspaceBreadcrumbs({ group, requisition, workspace }: { group?: BreadcrumbItem; requisition?: BreadcrumbItem; workspace: BreadcrumbItem }) {
  const items = [workspace, group, requisition].filter(Boolean) as BreadcrumbItem[];

  return (
    <nav aria-label="Workspace breadcrumbs" className="mb-2 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs font-semibold text-slate">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight aria-hidden="true" className="shrink-0 text-cool" size={14} /> : null}
            <Link href={item.href} aria-current={item.current ? "page" : undefined} className={`min-w-0 max-w-full break-words rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 ${item.current ? "text-navy" : "text-primary"}`} onClick={item.onSelect}>{item.label}</Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
