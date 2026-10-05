import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import { BUILTIN_DASHBOARD_REPORTS, dashboardNavigationKind, validateDashboardReports, type DashboardReportIdentity } from "../../src/lib/dashboard-report-registry";
import { dashboardDefaults, dashboardEffectivePreferences, dashboardReportRange, restoreDashboardPreferences, scopeDashboardRequisitions } from "../../src/lib/dashboard-filters";

const future: DashboardReportIdentity = { id: "retention-trends", label: { en: "Retention trends", th: "แนวโน้มการคงอยู่" }, filters: ["site"] };
const registry = [...BUILTIN_DASHBOARD_REPORTS, future];

test("registered future reports restore from URL/session without parser edits", () => {
  const base = { ...dashboardDefaults("2026-10-04"), tab: future.id };
  expect(restoreDashboardPreferences(new URLSearchParams(`dashboardTab=${future.id}&dashboardMonth=2026-08&funnelView=ytd`), base, registry).tab).toBe(future.id);
  expect(restoreDashboardPreferences(new URLSearchParams(`dashboardTab=${future.id}&funnelView=ytd`), base, registry).period).toBe("mtd");
  expect(restoreDashboardPreferences(new URLSearchParams(), base, registry).tab).toBe(future.id);
  expect(restoreDashboardPreferences(new URLSearchParams("dashboardTab=removed-report"), base, BUILTIN_DASHBOARD_REPORTS).tab).toBe("performance");
  expect(restoreDashboardPreferences(new URLSearchParams("dashboardTab=performance"), base, [future]).tab).toBe(future.id);
});

test("capabilities narrow only declared filters and retain saved selections", () => {
  const state = { ...dashboardDefaults("2026-10-04"), sites: ["HQ"], departments: ["Finance"], levels: ["4-6" as const] };
  // These rows have already passed header Site/PIC/Priority authorization.
  const rows = [{ site: "HQ", department: "Finance", level: "4" }, { site: "HQ", department: "HR", level: "0" }, { site: "KT1", department: "Finance", level: "4" }];
  expect(scopeDashboardRequisitions(rows, state, future.filters)).toEqual(rows.slice(0, 2));
  expect(scopeDashboardRequisitions(rows, state, ["department"])).toEqual([rows[0], rows[2]]);
  expect(scopeDashboardRequisitions(rows, state, ["level"])).toEqual([rows[0], rows[2]]);
  expect(scopeDashboardRequisitions(rows, state, [])).toEqual(rows);
  expect(scopeDashboardRequisitions(rows, state, BUILTIN_DASHBOARD_REPORTS[0].filters)).toEqual([rows[0]]);
  expect(dashboardEffectivePreferences(state, future.filters).departments).toEqual([]);
  expect(state.departments).toEqual(["Finance"]);
});

test("reports without period support render despite an invalid saved Custom range", () => {
  const state = { ...dashboardDefaults("2026-10-04"), period: "custom" as const, customStart: "bad", customEnd: "2026-01-01" };
  expect(dashboardReportRange(state, "2026-10-04", future.filters)).toEqual({ start: "", end: "", valid: true });
  expect(dashboardReportRange(state, "2026-10-04", ["period"]).valid).toBe(false);
});

test("registry validates IDs, bilingual labels and capabilities", () => {
  expect(validateDashboardReports(registry)).toEqual(registry);
  expect(() => validateDashboardReports([])).toThrow();
  expect(() => validateDashboardReports([...registry, future])).toThrow(/duplicate/);
  expect(() => validateDashboardReports([{ ...future, id: "bad/id" }])).toThrow();
  expect(() => validateDashboardReports([{ ...future, label: { en: "", th: "ไทย" } }])).toThrow();
  expect(() => validateDashboardReports([{ ...future, filters: ["site", "site"] }])).toThrow();
});

test("navigation switches from tabs to selector above five registered reports", () => {
  const many = [...registry, ...["cost", "forecast", "capacity"].map(id => ({ ...future, id }))];
  expect(dashboardNavigationKind(many.slice(0, 5))).toBe("tabs");
  expect(dashboardNavigationKind(many.slice(0, 6))).toBe("selector");
  expect(validateDashboardReports(many).map(report => report.id)).toContain("retention-trends");
  expect(restoreDashboardPreferences(new URLSearchParams("dashboardTab=capacity"), dashboardDefaults("2026-10-04"), many).tab).toBe("capacity");
});


test("actual navigation renders five tabs or a bilingual selector for six reports", async () => {
  // Compile the actual components outside Playwright's JSX test transform.
  const root = process.cwd(), nativeRequire = createRequire(path.join(root, "package.json"));
  const cache = new Map<string, { exports: unknown }>();
  function load(file: string): unknown {
    if (cache.has(file)) return cache.get(file)!.exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;
    const localRequire = (name: string): unknown => {
      if (!name.startsWith("@/") && !name.startsWith(".")) return nativeRequire(name);
      const target = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(file), name);
      return load(target + (target.includes("components") ? ".tsx" : ".ts"));
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  }
  const { DashboardReportNavigation } = load(path.join(root, "src/components/dashboard/DashboardReportNavigation.tsx")) as { DashboardReportNavigation: React.ComponentType<any> };
  const React = nativeRequire("react"), { renderToStaticMarkup } = nativeRequire("react-dom/server");
  const reports = [...registry, ...["cost", "forecast", "capacity"].map(id => ({ ...future, id }))];
  const render = (count: number, language: string) => renderToStaticMarkup(React.createElement(DashboardReportNavigation, { reports: reports.slice(0, count), selectedId: future.id, language, onSelect: () => {} }));
  expect(render(5, "en").match(/role="tab"/g)).toHaveLength(5);
  expect(render(5, "en")).toContain('aria-selected="true"');
  expect(render(6, "en")).toContain('aria-label="Report"');
  expect(render(6, "en")).toContain("Retention trends");
  expect(render(6, "en")).not.toContain('role="tablist"');
  expect(render(6, "th")).toContain('aria-label="รายงาน"');
  expect(render(6, "th")).toContain(future.label.th);
});
