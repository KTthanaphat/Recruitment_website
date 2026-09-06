import { expect, test } from "@playwright/test";
import { filledSlaAtAcceptance, waterfallExecutiveRows } from "../../src/lib/vacancy-executive";

const req = { pr_approved_date: "2026-01-01", level: "L6", status: "ongoing" };
test("filled SLA uses acceptance boundaries and historical restarts", () => {
  expect(filledSlaAtAcceptance(req, "2026-01-31", [])).toBe(true);
  expect(filledSlaAtAcceptance(req, "2026-02-01", [])).toBe(false);
  expect(filledSlaAtAcceptance({ ...req, level: "L9" }, "2026-02-15", [])).toBe(true);
  expect(filledSlaAtAcceptance({ ...req, level: "L10" }, "2026-03-02", [])).toBe(true);
  expect(filledSlaAtAcceptance({ ...req, sla_restart_date: "2026-04-01" }, "2026-02-15", ["2026-02-01", "2026-04-01"])).toBe(true);
  expect(filledSlaAtAcceptance({ ...req, sla_restart_date: "2026-04-01" }, "2026-02-15", [])).toBe(false);
  expect(filledSlaAtAcceptance({ ...req, level: null }, "2026-01-15", [])).toBeNull();
  expect(filledSlaAtAcceptance({ ...req, pr_approved_date: "2026-02-30" }, "2026-03-15", [])).toBeNull();
  expect(filledSlaAtAcceptance(req, "2025-12-31", [])).toBeNull();
});

test("executive balances retain signs, fixed empty sites, and weighted SLA", () => {
  const movement = (site: string, category: string, count: number, extra = {}) => ({ site, waterfall_category: category, request_type: "New", vacancy_count: count, ...extra });
  const rows = waterfallExecutiveRows([
    movement("KT2", "Week Start", 2), movement("KT2", "Open", 1), movement("KT2", "Filled", -4, { filledInSla: 3, filledSlaUnknown: 0 }), movement("KT2", "Total", -1),
    movement("HQ", "Week Start", 3), movement("HQ", "Filled", -3, { filledInSla: 1, filledSlaUnknown: 0 }), movement("HQ", "Total", 0)
  ]);
  expect(rows.map(row => row.site)).toEqual(["HQ", "KT1", "KT2", "Total"]);
  expect(rows[1].slaPercent).toBeNull();
  expect(rows[2].closing).toBe(-1);
  expect(rows[3].slaPercent).toBe(57);
  rows.forEach(row => expect(row.opening + row.opened - row.filled).toBe(row.closing));
  expect(waterfallExecutiveRows([movement("HQ", "Filled", -1, { filledInSla: 0, filledSlaUnknown: 1 })]).at(-1)?.slaPercent).toBeNull();
});
