import { Button } from "@/components/ui/Button";
import { PAGE_SIZE_OPTIONS } from "@/components/ui/Pagination";
import { translate } from "@/lib/i18n/dictionary";
import type { Language } from "@/types/recruitment";

export function CursorPagination({ language, page, pageSize, loading, canPrevious, canNext, onPrevious, onNext, onPageSizeChange }: {
  language: Language;
  page: number;
  pageSize: number;
  loading: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (size: number) => void;
}) {
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#D7DEE8] pt-3 text-sm">
    <span className="text-slate">{translate(language,"page")} {page}</span>
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" disabled={!canPrevious||loading} onClick={onPrevious}>{translate(language,"previous")}</Button>
      <Button type="button" variant="secondary" disabled={!canNext||loading} onClick={onNext}>{translate(language,"next")}</Button>
      <select aria-label={translate(language,"rowsPerPage")} value={pageSize} onChange={event=>onPageSizeChange(Number(event.target.value))} className="min-h-10 rounded-md border border-[#C9D5E6] bg-white px-2">
        {PAGE_SIZE_OPTIONS.map(size=><option key={size} value={size}>{size}</option>)}
      </select>
    </div>
  </div>;
}
