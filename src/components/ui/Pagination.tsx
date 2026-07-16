import { SelectInput } from "@/components/ui/Field";
import { formatNumber } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { Language } from "@/types/recruitment";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function Pagination({
  language,
  page,
  pageSize,
  totalRows,
  onPageChange,
  onPageSizeChange
}: {
  language: Language;
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = totalRows === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(totalRows, safePage * pageSize);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#D7DEE8] pt-3 text-sm font-medium text-navy">
      <p aria-live="polite">
        {translate(language, "showingRows")
          .replace("{start}", formatNumber(start, language))
          .replace("{end}", formatNumber(end, language))
          .replace("{total}", formatNumber(totalRows, language))}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span>{translate(language, "rowsPerPage")}</span>
          <SelectInput
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label={translate(language, "rowsPerPage")}
            className="min-h-9 w-16 py-1 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </SelectInput>
        </label>
        <button
          type="button"
          className={`grid size-9 place-items-center rounded text-lg font-medium transition-colors ${
            safePage <= 1 ? "cursor-not-allowed text-cool" : "text-navy hover:bg-lightgray hover:text-primary"
          }`}
          disabled={safePage <= 1}
          aria-label={translate(language, "previousPage")}
          onClick={() => onPageChange(safePage - 1)}
        >
          {"<"}
        </button>
        <span className="min-w-28 text-center">
          {translate(language, "pageOf")
            .replace("{current}", formatNumber(safePage, language))
            .replace("{total}", formatNumber(totalPages, language))}
        </span>
        <button
          type="button"
          className={`grid size-9 place-items-center rounded text-lg font-medium transition-colors ${
            safePage >= totalPages ? "cursor-not-allowed text-cool" : "text-navy hover:bg-lightgray hover:text-primary"
          }`}
          disabled={safePage >= totalPages}
          aria-label={translate(language, "nextPage")}
          onClick={() => onPageChange(safePage + 1)}
        >
          {">"}
        </button>
      </div>
    </div>
  );
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    rows: rows.slice(start, start + pageSize)
  };
}
