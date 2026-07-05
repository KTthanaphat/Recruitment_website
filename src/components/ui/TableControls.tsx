"use client";

import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc" | null;

export type TableColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  filterValue?: (row: T) => string | number | null | undefined;
  sortValue?: (row: T) => string | number | null | undefined;
};

export function useTableControls<T>(rows: T[], columns: TableColumn<T>[]) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const controlledRows = useMemo(() => {
    const filtered = rows.filter((row) => columns.every((column) => {
      const filterText = (filters[column.key] ?? "").trim().toLowerCase();
      if (!filterText) return true;
      const rawValue = column.filterValue?.(row) ?? column.value(row);
      return String(rawValue ?? "").toLowerCase().includes(filterText);
    }));

    if (!sortKey || !sortDirection) return filtered;
    const sortColumn = columns.find((column) => column.key === sortKey);
    if (!sortColumn) return filtered;

    return [...filtered].sort((a, b) => {
      const left = sortColumn.sortValue?.(a) ?? sortColumn.value(a);
      const right = sortColumn.sortValue?.(b) ?? sortColumn.value(b);
      const delta = compareSortValues(left, right);
      return sortDirection === "asc" ? delta : -delta;
    });
  }, [columns, filters, rows, sortDirection, sortKey]);

  function setFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleSort(key: string) {
    setSortKey((currentKey) => {
      if (currentKey !== key) {
        setSortDirection("asc");
        return key;
      }
      setSortDirection((currentDirection) => {
        if (currentDirection === "asc") return "desc";
        if (currentDirection === "desc") return null;
        return "asc";
      });
      return key;
    });
  }

  return {
    controlledRows,
    filters,
    setFilter,
    sortDirection,
    sortKey,
    toggleSort
  };
}

export function SortableFilterHeader({
  columnKey,
  filterValue,
  label,
  onFilter,
  onSort,
  sortDirection,
  sortKey
}: {
  columnKey: string;
  filterValue: string;
  label: string;
  onFilter: (key: string, value: string) => void;
  onSort: (key: string) => void;
  sortDirection: SortDirection;
  sortKey: string | null;
}) {
  const active = sortKey === columnKey && sortDirection;
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowDownUp;

  return (
    <div className="grid min-w-28 gap-1">
      <button
        type="button"
        className="flex items-center justify-between gap-2 text-left font-semibold text-slate transition-colors hover:text-primary"
        onClick={() => onSort(columnKey)}
        aria-label={`Sort ${label}`}
      >
        <span>{label}</span>
        <Icon size={13} aria-hidden="true" />
      </button>
      <input
        className="min-h-8 rounded border border-[#C9D5E6] bg-white px-2 py-1 text-xs font-medium normal-case text-navy placeholder:text-cool focus:border-electric focus:outline-none"
        value={filterValue}
        onChange={(event) => onFilter(columnKey, event.target.value)}
        placeholder="Filter"
        aria-label={`Filter ${label}`}
      />
    </div>
  );
}

function compareSortValues(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "" ? 0 : 1;
  if (right === null || right === undefined || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}
