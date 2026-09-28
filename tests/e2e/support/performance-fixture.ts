import type { DashboardData } from "../../../src/types/recruitment";

/** Reference distribution: 40 approved, 16 accepted, 30/6/1/3/0 by ascending band. */
export function installPerformanceFixture(data: DashboardData) {
  const base = data.requisitions[0], offer = data.offers[0];
  const distribution: [string, string, number, number][] = [
    ["HQ", "L0", 2, 2], ["HQ", "L4", 1, 0],
    ["KT1", "L0", 17, 8], ["KT1", "L4", 1, 0], ["KT1", "L7", 1, 0], ["KT1", "L10", 1, 0],
    ["KT2", "L0", 10, 5], ["KT2", "L4", 4, 0], ["KT2", "L10", 2, 0], ["KT1", "L0", 1, 1]
  ];
  data.requisitions = distribution.map(([site, level, head_count], index) => ({
    ...base, doc_id: `REF-${index}`, site, level, head_count, department: "Operations", status: "ongoing",
    request_type: index % 2 ? "New" : "Replacement", pr_approved_date: index === 9 ? "2026-05-08" : "2026-06-01"
  }));
  data.requisition_logs = [];
  let accepted = 0;
  data.offers = distribution.flatMap(([, , , filled], index) => Array.from({ length: filled }, (_, count) => ({
    ...offer, offer_id: 1000 + index * 100 + count, doc_id: `REF-${index}`, candidate_id: `REF-C-${index}-${count}`,
    accepted_date: index === 9 ? "2026-06-08" : accepted++ < 6 ? "2026-06-07" : "2026-06-06", start_confirmation: null, start_confirmed_at: null
  })));
}
