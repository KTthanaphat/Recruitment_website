import { formatRecruitmentId } from "./format";

/** Canonicalize only a complete CAN/GRP query; arbitrary text search stays unchanged. */
export function normalizeRecruitmentIdSearch(value: string): string | null {
  const match = value.trim().match(/^(CAN|GRP)-([0-9]+)$/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2].padStart(Math.max(5, match[2].length), "0")}`;
}

/** Match the literal and padded display forms while preserving every stored ID. */
export function matchesRecruitmentIdSearch(id: string | null | undefined, query: string): boolean {
  const raw = id ?? "", term = query.trim().toLocaleLowerCase();
  if (!term) return true;
  const display = formatRecruitmentId(raw).toLocaleLowerCase();
  const normalized = normalizeRecruitmentIdSearch(query)?.toLocaleLowerCase();
  return raw.toLocaleLowerCase().includes(term) || display.includes(term)
    || Boolean(normalized && (raw.toLocaleLowerCase().includes(normalized) || display.includes(normalized)));
}
