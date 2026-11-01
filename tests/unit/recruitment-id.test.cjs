const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const sourcePath = path.resolve(__dirname, "../../src/lib/format.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const formatModule = { exports: {} };
const formatRequire = request => {
  if (request === "@/lib/i18n/dictionary") return { resultLabel: () => "" };
  return require(request);
};
new Function("require", "module", "exports", compiled)(formatRequire, formatModule, formatModule.exports);
const { formatRecruitmentId, resolveRecruitmentId } = formatModule.exports;
const searchPath = path.resolve(__dirname, "../../src/lib/recruitment-id-search.ts");
const searchCompiled = ts.transpileModule(fs.readFileSync(searchPath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const searchModule = { exports: {} };
new Function("require", "module", "exports", searchCompiled)(request => request === "./format" ? formatModule.exports : require(request), searchModule, searchModule.exports);
const { normalizeRecruitmentIdSearch, matchesRecruitmentIdSearch } = searchModule.exports;

test("candidate and group IDs display with five digits as a minimum", () => {
  assert.equal(formatRecruitmentId("CAN-0001"), "CAN-00001");
  assert.equal(formatRecruitmentId("GRP-01234"), "GRP-01234");
  assert.equal(formatRecruitmentId("can-1"), "CAN-00001");
  assert.equal(formatRecruitmentId("CAN-100000"), "CAN-100000");
  assert.equal(formatRecruitmentId("CAN-1A"), "CAN-1A");
  assert.equal(formatRecruitmentId("DGRP-001"), "DGRP-001");
  assert.equal(formatRecruitmentId(null), "");
});

test("ID resolution prefers exact stored values before padded aliases", () => {
  const stored = ["CAN-0001", "CAN-00001", "CAN-12000"];
  assert.deepEqual(resolveRecruitmentId("CAN-00001", stored), { status: "matched", id: "CAN-00001" });
  assert.deepEqual(resolveRecruitmentId("CAN-01200", ["CAN-1200"]), { status: "matched", id: "CAN-1200" });
  assert.deepEqual(resolveRecruitmentId("CAN-88888", stored), { status: "missing" });
});

test("ID resolution rejects ambiguous padded aliases instead of selecting a row", () => {
  assert.deepEqual(resolveRecruitmentId("CAN-00001", ["CAN-0001", "CAN-00001"]), { status: "matched", id: "CAN-00001" });
  assert.deepEqual(resolveRecruitmentId("GRP-00001", ["GRP-0001", "GRP-00001"]), { status: "matched", id: "GRP-00001" });
  assert.deepEqual(resolveRecruitmentId("CAN-00001", ["CAN-1", "CAN-01"]), { status: "ambiguous", ids: ["CAN-01", "CAN-1"] });
});

test("complete CAN/GRP search aliases match raw and padded display IDs without truncating long suffixes", () => {
  assert.equal(normalizeRecruitmentIdSearch("can-33"), "CAN-00033");
  assert.equal(normalizeRecruitmentIdSearch("GRP-123456"), "GRP-123456");
  assert.equal(normalizeRecruitmentIdSearch("CAN-33 search"), null);
  assert.equal(matchesRecruitmentIdSearch("CAN-33", "CAN-00033"), true);
  assert.equal(matchesRecruitmentIdSearch("CAN-00033", "can-33"), true);
  assert.equal(matchesRecruitmentIdSearch("GRP-123456", "grp-123456"), true);
  assert.equal(matchesRecruitmentIdSearch("CAN-133", "CAN-33"), false);
});
