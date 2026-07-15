import type { SortDirection, TableControlsInitialState } from "@/components/ui/TableControls";

export type TableUrlState = TableControlsInitialState & {
  page: number;
  pageSize: number;
};

export function readTableUrlState(prefix: string): TableUrlState {
  if (typeof window === "undefined") return defaultTableUrlState();
  const params = new URLSearchParams(window.location.search);
  const sortDirection = params.get(`${prefix}Dir`);
  return {
    filters: parseFilters(params.get(`${prefix}Filters`)),
    page: positiveNumber(params.get(`${prefix}Page`), 1),
    pageSize: positiveNumber(params.get(`${prefix}Size`), 25),
    search: params.get(`${prefix}Search`) ?? "",
    sortDirection: sortDirection === "asc" || sortDirection === "desc" ? sortDirection : null,
    sortKey: params.get(`${prefix}Sort`)
  };
}

export function writeTableUrlValues(prefix: string, state: TableUrlState) {
  const filters = state.filters ?? {};
  return {
    [`${prefix}Dir`]: state.sortDirection,
    [`${prefix}Filters`]: Object.keys(filters).length > 0 ? JSON.stringify(filters) : null,
    [`${prefix}Page`]: state.page > 1 ? state.page : null,
    [`${prefix}Search`]: state.search,
    [`${prefix}Size`]: state.pageSize !== 25 ? state.pageSize : null,
    [`${prefix}Sort`]: state.sortKey
  };
}

function defaultTableUrlState(): TableUrlState {
  return {
    filters: {},
    page: 1,
    pageSize: 25,
    search: "",
    sortDirection: null,
    sortKey: null
  };
}

function parseFilters(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
    );
  } catch {
    return {};
  }
}

function positiveNumber(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
