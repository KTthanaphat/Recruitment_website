import type { RecruitmentLog } from "@/types/recruitment";

type HistoryPage = {
  data: unknown;
  count?: number | null;
  error: { message: string } | null;
};

export type RecruitmentHistoryClient = {
  from: (table: string) => {
    select: (columns: string, options: { count: "exact" }) => {
      order: (column: string, options: { ascending: boolean }) => {
        range: (from: number, to: number) => PromiseLike<HistoryPage>;
      };
    };
  };
};

/** Load complete authorized history, including rows older than a bulk import. */
export async function loadRecruitmentHistory(client: RecruitmentHistoryClient): Promise<RecruitmentLog[]> {
  const pageSize = 500;
  const rows: RecruitmentLog[] = [];
  const seen = new Set<number>();
  let expected: number | null = null;

  for (let offset = 0; ; offset += pageSize) {
    // Imports share timestamps, so use the unique key for deterministic pages.
    const result = await client.from("recruitment_logs")
      .select("*", { count: "exact" })
      .order("log_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    if (typeof result.count !== "number") {
      throw new Error("Unable to verify complete stage history. Please refresh.");
    }
    if (expected !== null && result.count !== expected) {
      throw new Error("Stage history changed while loading. Please refresh.");
    }
    expected = result.count;
    const page = (result.data ?? []) as RecruitmentLog[];
    for (const row of page) {
      if (!Number.isSafeInteger(row.log_id) || seen.has(row.log_id)) {
        throw new Error("Duplicate or invalid stage-history page. Please refresh.");
      }
      seen.add(row.log_id);
      rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (page.length < pageSize || rows.length > expected) {
      throw new Error("Incomplete stage history received. Please refresh.");
    }
  }
}
