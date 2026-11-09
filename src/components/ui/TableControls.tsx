"use client";

import { createPortal } from "react-dom";
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { Language } from "@/types/recruitment";

export type SortDirection = "asc" | "desc" | null;

export function RecordSortTriangles({ direction }: { direction: SortDirection | false }) {
  return <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true" focusable="false" data-record-sort-triangles>
    <path d="M6 1 10 6H2Z" fill={direction === "asc" ? "#0A3CDC" : "#A9B6C9"} />
    <path d="M6 15 2 10h8Z" fill={direction === "desc" ? "#0A3CDC" : "#A9B6C9"} />
  </svg>;
}

export type TableColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  filterValue?: (row: T) => string | number | null | undefined;
  searchValue?: (row: T) => string | number | null | undefined;
  filterMode?: "category";
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
        const rawValue = column.searchValue?.(row) ?? column.filterValue?.(row) ?? column.value(row);
        return String(rawValue ?? "").toLowerCase().includes(searchText);
      });
      if (!matchesSearch) return false;

      return columns.every((column) => {
      const filterText = (filters[column.key] ?? "").trim().toLowerCase();
      if (!filterText) return true;
      const rawValue = column.filterValue?.(row) ?? column.value(row);
      if (column.filterMode === "category") {
        return decodeCategoryFilter(filterText).includes(String(rawValue ?? "-").trim().toLowerCase());
      }
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

  function categoryFilterOptions(key: string) {
    const column = columns.find((item) => item.key === key);
    if (!column || column.filterMode !== "category") return undefined;
    return Array.from(new Set(rows.map((row) => String(column.filterValue?.(row) ?? column.value(row) ?? "-").trim()).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
  }

  return {
    categoryFilterOptions,
    controlledRows,
    filters,
    search,
    setFilter,
    setFilters,
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
  trailingActions,
  totalCount,
  records = false,
  hideFilters = false,
  filtersActive = false,
  controls,
  searchLabel,
  advancedFiltersPanelId
}: {
  advancedFiltersOpen: boolean;
  language: Language;
  onAdvancedFiltersToggle: () => void;
  onSearch: (value: string) => void;
  resultCount: number | null;
  searchValue: string;
  trailingActions?: ReactNode;
  totalCount: number | null;
  records?: boolean;
  hideFilters?: boolean;
  filtersActive?: boolean;
  controls?: ReactNode;
  searchLabel?: string;
  advancedFiltersPanelId?: string;
}) {
  return (
    <div data-table-toolbar className={records ? "records-toolbar" : "mb-3 flex flex-col gap-2 rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] p-3 sm:flex-row sm:items-center sm:justify-between"}>
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{searchLabel ?? translate(language, "searchTable")}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate" size={15} aria-hidden="true" />
        <input
          className="min-h-10 w-full rounded-xl border border-[#C9D5E6] bg-white py-1.5 pl-9 pr-3 text-sm font-medium text-navy placeholder:text-cool focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          value={searchValue}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={translate(language, "searchRecords")}
          type="search"
        />
      </label>
      {controls}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
        <span className="text-xs font-medium text-slate">{translate(language, "recordsCount", { result: resultCount === null ? "…" : formatNumber(resultCount, language), total: totalCount === null ? "…" : formatNumber(totalCount, language) })}</span>
        {!hideFilters ? <button
          type="button"
          className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${
            (advancedFiltersOpen || filtersActive) ? "bg-primary text-white hover:bg-primary/90" : "bg-white text-navy ring-1 ring-inset ring-[#C9D5E6] hover:bg-[#F8FAFD]"
          }`}
          aria-label={translate(language,"advancedFilters")}
          title={translate(language,"advancedFilters")}
          data-filters-active={filtersActive}
          aria-controls={advancedFiltersPanelId}
          aria-expanded={advancedFiltersOpen}
          aria-pressed={advancedFiltersOpen}
          onClick={onAdvancedFiltersToggle}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span className={records ? "sr-only" : undefined}>{translate(language, "advancedFilters")}</span>
        </button> : null}
        {trailingActions}
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
  filterOptions,
  sortDirection,
  sortKey,
  showFilter = true,
  viewportBoundedFilters = false
}: {
  columnKey: string;
  filterValue: string;
  language: Language;
  label: string;
  onFilter: (key: string, value: string) => void;
  onSort: (key: string) => void;
  filterOptions?: string[];
  sortDirection: SortDirection;
  sortKey: string | null;
  showFilter?: boolean;
  viewportBoundedFilters?: boolean;
}) {
  const active = sortKey === columnKey && sortDirection;
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowDownUp;

  return (
    <div className="grid min-w-28 gap-1">
      <button
        type="button"
        className={"flex items-center text-left font-semibold text-slate transition-colors hover:text-navy focus:outline-none focus:ring-2 focus:ring-primary/25 "+(viewportBoundedFilters?"justify-start gap-1.5":"justify-between gap-2")}
        onClick={() => onSort(columnKey)}
        aria-label={translate(language, "sortLabel", { label })}
      >
        <span>{label}</span>
        {viewportBoundedFilters ? <RecordSortTriangles direction={active} /> : <Icon size={13} aria-hidden="true" />}
      </button>
      {showFilter ? <TableFilterField columnKey={columnKey} filterValue={filterValue} language={language} label={label} onFilter={onFilter} filterOptions={filterOptions} viewportBounded={viewportBoundedFilters}/> : null}
    </div>
  );
}

export function TableFilterField({columnKey,filterValue,language,label,onFilter,filterOptions,viewportBounded=false,sidebar=false}:{columnKey:string;filterValue:string;language:Language;label:string;onFilter:(key:string,value:string)=>void;filterOptions?:string[];viewportBounded?:boolean;sidebar?:boolean}) {
  return filterOptions ? <CategoryFilter columnKey={columnKey} filterValue={filterValue} language={language} options={filterOptions} onFilter={onFilter} label={label} viewportBounded={viewportBounded} sidebar={sidebar}/> : <input className="min-h-8 min-w-0 w-full rounded-lg border border-[#C9D5E6] bg-white px-2 py-1 text-xs font-medium normal-case text-navy placeholder:text-cool focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" value={filterValue} onChange={event=>onFilter(columnKey,event.target.value)} placeholder={translate(language,"filter")} aria-label={translate(language,"filterLabel",{label})}/>;
}

export function TruncatedTableText({ value, maxLength = 36, className = "" }: { value: string | number | null | undefined; maxLength?: number; className?: string }) {
  const text = String(value ?? "-");
  const shortened = text.length > maxLength;
  return <span className={`block min-w-0 ${className}`} title={shortened ? text : undefined}>{shortened ? `${text.slice(0, maxLength).trimEnd()}...` : text}</span>;
}

function CategoryFilter({ columnKey, filterValue, language, options, onFilter, label, viewportBounded=false, sidebar=false }: { columnKey: string; filterValue: string; language: Language; options: string[]; onFilter: (key: string, value: string) => void; label: string; viewportBounded?:boolean; sidebar?:boolean }) {

  const detailsRef=useRef<HTMLDetailsElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const [menuPosition,setMenuPosition]=useState<CSSProperties>();
  useEffect(()=>{
    if(!viewportBounded||!menuOpen)return;
    const place=()=>{
      const trigger=detailsRef.current?.querySelector("summary");
      const menu=menuRef.current;
      if(!trigger||!menu)return;
      const rect=trigger.getBoundingClientRect();
      const below=window.innerHeight-rect.bottom-12,above=rect.top-12;
      const desired=Math.min(240,menu.scrollHeight);
      const flip=below<Math.min(160,desired)&&above>below;
      const height=Math.min(desired,Math.max(44,flip?above:below));
      const width=Math.min(Math.max(rect.width,192),window.innerWidth-24);
      setMenuPosition({position:"fixed",left:Math.max(12,Math.min(rect.left,window.innerWidth-12-width)),top:flip?rect.top-height-4:rect.bottom+4,width,maxHeight:height,marginTop:0,zIndex:120});
    };
    place();window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
    return()=>{window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};
  },[viewportBounded,menuOpen,options.length]);

  useEffect(()=>{if(!viewportBounded||!menuOpen)return;const dismiss=(event:PointerEvent)=>{const node=event.target as Node;if(!detailsRef.current?.contains(node)&&!menuRef.current?.contains(node)&&detailsRef.current)detailsRef.current.open=false;};document.addEventListener("pointerdown",dismiss);return()=>document.removeEventListener("pointerdown",dismiss);},[viewportBounded,menuOpen]);

  const selected = decodeCategoryFilter(filterValue);
  const allSelected = options.length > 0 && options.every((option) => selected.includes(option.toLowerCase()));
  const selectedCount = options.filter((option) => selected.includes(option.toLowerCase())).length;

  function update(next: string[]) {
    onFilter(columnKey, next.length === 0 || !viewportBounded && next.length === options.length ? "" : JSON.stringify(next));
  }

  const menu = (<div ref={menuRef} data-category-menu style={viewportBounded?{...menuPosition,visibility:menuPosition?"visible":"hidden"}:undefined} className={"ats-dropdown-menu absolute left-0 z-30 mt-1 grid max-h-60 min-w-48 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border text-navy "+(sidebar?"text-sm font-normal":"text-xs font-medium")}>
        <label className={`ats-dropdown-option flex items-center gap-2 ${sidebar ? "font-normal" : "font-semibold"} ${allSelected ? "is-selected" : ""}`}>
          <input type="checkbox" checked={allSelected} onChange={(event) => update(event.target.checked ? options : [])} />
          {translate(language, "selectAll")}
        </label>
        {options.map((option) => {
          const checked = selected.includes(option.toLowerCase());
          return <label key={option} className={`ats-dropdown-option flex items-center gap-2 ${checked ? "is-selected" : ""}`}><input type="checkbox" checked={checked} onChange={(event) => update(event.target.checked ? [...selected, option] : selected.filter((value) => value !== option.toLowerCase()))} /><span className="break-words">{option}</span></label>;
        })}
      </div>);
  return (
    <details ref={detailsRef} onToggle={event=>{if(viewportBounded){setMenuOpen(event.currentTarget.open);if(!event.currentTarget.open)setMenuPosition(undefined);}}} onKeyDown={event=>{if(viewportBounded&&event.key==="Escape"&&event.currentTarget.open){event.preventDefault();event.currentTarget.open=false;event.currentTarget.querySelector("summary")?.focus();}}} className="relative min-w-28 normal-case">
      <summary className={"ats-dropdown-trigger flex min-w-0 cursor-pointer list-none items-center justify-between border text-navy [&::-webkit-details-marker]:hidden "+(sidebar?"min-h-11 gap-2 rounded-xl px-3 text-sm font-normal":"min-h-8 gap-1 rounded-lg px-2 py-1 text-xs font-medium")} aria-label={translate(language, "filterLabel", { label })}>
        <span className="min-w-0 truncate" title={selectedCount === 0 ? translate(language, "all") : translate(language, "filterSelected", { count: selectedCount })}>{selectedCount === 0 ? translate(language, "all") : translate(language, "filterSelected", { count: selectedCount })}</span>
        {sidebar?<ChevronDown size={17} className="shrink-0 text-slate" aria-hidden="true"/>:<span aria-hidden="true">⌄</span>}
      </summary>
      {viewportBounded ? (menuOpen && typeof document!=="undefined" ? createPortal(menu,document.body) : null) : menu}
    </details>
  );
}

function decodeCategoryFilter(value: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean);
  } catch {
    // Legacy text filters stay usable as a single category selection.
  }
  return [value.trim().toLowerCase()];
}

function compareSortValues(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "" ? 0 : 1;
  if (right === null || right === undefined || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}
