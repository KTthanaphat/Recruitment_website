"use client";

import { ArrowDown, ArrowDownUp, ArrowUp, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { Language } from "@/types/recruitment";

export type SortDirection = "asc" | "desc" | null;

export type TableColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  filterValue?: (row: T) => string | number | null | undefined;
  sortValue?: (row: T) => string | number | null | undefined;
};

export type TableControlsInitialState = {
  filters?: Record<string, string>;
  search?: string;
  sortDirection?: SortDirection;
  sortKey?: string | null;
};

export function useTableControls<T>(rows: T[], columns: TableColumn<T>[], initialState: TableControlsInitialState = {}) {
  const [sortKey, setSortKey] = useState<string | null>(initialState.sortKey ?? null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialState.sortDirection ?? null);
  const [filters, setFilters] = useState<Record<string, string>>(initialState.filters ?? {});
  const [search, setSearch] = useState(initialState.search ?? "");

  const controlledRows = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const matchesSearch = !searchText || columns.some((column) => {
        const rawValue = column.filterValue?.(row) ?? column.value(row);
        return String(rawValue ?? "").toLowerCase().includes(searchText);
      });
      if (!matchesSearch) return false;

      return columns.every((column) => {
      const filterText = (filters[column.key] ?? "").trim().toLowerCase();
      if (!filterText) return true;
      const rawValue = column.filterValue?.(row) ?? column.value(row);
      return String(rawValue ?? "").toLowerCase().includes(filterText);
      });
    });

    if (!sortKey || !sortDirection) return filtered;
    const sortColumn = columns.find((column) => column.key === sortKey);
    if (!sortColumn) return filtered;

    return [...filtered].sort((a, b) => {
      const left = sortColumn.sortValue?.(a) ?? sortColumn.value(a);
      const right = sortColumn.sortValue?.(b) ?? sortColumn.value(b);
      const delta = compareSortValues(left, right);
      return sortDirection === "asc" ? delta : -delta;
    });
  }, [columns, filters, rows, search, sortDirection, sortKey]);

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
    search,
    setFilter,
    setSearch,
    sortDirection,
    sortKey,
    toggleSort
  };
}

export function TableToolbar({
  advancedFiltersOpen,
  language,
  onAdvancedFiltersToggle,
  onSearch,
  resultCount,
  searchValue,
  totalCount
}: {
  advancedFiltersOpen: boolean;
  language: Language;
  onAdvancedFiltersToggle: () => void;
  onSearch: (value: string) => void;
  resultCount: number;
  searchValue: string;
  totalCount: number;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] p-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{translate(language, "searchTable")}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate" size={15} aria-hidden="true" />
        <input
          className="min-h-10 w-full rounded-xl border border-[#C9D5E6] bg-white py-1.5 pl-9 pr-3 text-sm font-medium text-navy placeholder:text-cool focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          value={searchValue}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={translate(language, "searchRecords")}
          type="search"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
        <span className="text-xs font-medium text-slate">{translate(language, "recordsCount", { result: formatNumber(resultCount, language), total: formatNumber(totalCount, language) })}</span>
        <button
          type="button"
          className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${
            advancedFiltersOpen ? "bg-primary text-white hover:bg-primary/90" : "bg-white text-navy ring-1 ring-inset ring-[#C9D5E6] hover:bg-[#F8FAFD]"
          }`}
          aria-pressed={advancedFiltersOpen}
          onClick={onAdvancedFiltersToggle}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {translate(language, "advancedFilters")}
        </button>
      </div>
    </div>
  );
}

export function SortableFilterHeader({
  columnKey,
  filterValue,
  language,
  label,
  onFilter,
  onSort,
  sortDirection,
  sortKey,
  showFilter = true
}: {
  columnKey: string;
  filterValue: string;
  language: Language;
  label: string;
  onFilter: (key: string, value: string) => void;
  onSort: (key: string) => void;
  sortDirection: SortDirection;
  sortKey: string | null;
  showFilter?: boolean;
}) {
  const active = sortKey === columnKey && sortDirection;
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowDownUp;

  return (
    <div className="grid min-w-28 gap-1">
      <button
        type="button"
        className="flex items-center justify-between gap-2 text-left font-semibold text-slate transition-colors hover:text-navy focus:outline-none focus:ring-2 focus:ring-primary/25"
        onClick={() => onSort(columnKey)}
        aria-label={translate(language, "sortLabel", { label })}
      >
        <span>{label}</span>
        <Icon size={13} aria-hidden="true" />
      </button>
      {showFilter ? (
        <input
          className="min-h-8 rounded-lg border border-[#C9D5E6] bg-white px-2 py-1 text-xs font-medium normal-case text-navy placeholder:text-cool focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
          value={filterValue}
          onChange={(event) => onFilter(columnKey, event.target.value)}
          placeholder={translate(language, "filter")}
          aria-label={translate(language, "filterLabel", { label })}
        />
      ) : null}
    </div>
  );
}

function compareSortValues(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "" ? 0 : 1;
  if (right === null || right === undefined || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}
