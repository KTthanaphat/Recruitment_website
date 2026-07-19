import type { Language } from "@/types/recruitment";

export type DepartmentSectionRow = {
  id: string;
  site: string;
  dep: string;
  sec: string;
  depEn: string;
  secEn: string;
};

export type SelectOption = {
  value: string;
  label: string;
};

export function parseDepartmentSectionCsv(csv: string): DepartmentSectionRow[] {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  return lines
    .map((line) => {
      const cells = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
      return {
        id: row.dep_sec_id?.trim() ?? "",
        site: row.site?.trim() ?? "",
        dep: row.dep?.trim() ?? "",
        sec: row.sec?.trim() ?? "",
        depEn: row.dep_en?.trim() ?? "",
        secEn: row.sec_en?.trim() ?? ""
      };
    })
    .filter((row) => row.id && row.site && (row.dep || row.depEn));
}

export function departmentOptions(rows: DepartmentSectionRow[], language: Language, site: string): SelectOption[] {
  return uniqueOptions(rows
    .filter((row) => siteMatches(row, site))
    .map((row) => ({
      value: canonicalDepartment(row),
      label: language === "th" ? row.dep || canonicalDepartment(row) : canonicalDepartment(row)
    })));
}

export function sectionOptionsForDepartment(rows: DepartmentSectionRow[], language: Language, site: string, department: string): SelectOption[] {
  const normalized = department.trim();
  if (!normalized) return [];
  return uniqueOptions(rows
    .filter((row) => siteMatches(row, site) && departmentMatches(row, normalized))
    .map((row) => ({
      value: canonicalSection(row),
      label: language === "th" ? row.sec || canonicalSection(row) : canonicalSection(row)
    }))
    .filter((option) => option.value));
}

export function appendLegacyOption(options: SelectOption[], value: string | null | undefined): SelectOption[] {
  const trimmed = value?.trim();
  if (!trimmed || options.some((option) => option.value === trimmed)) return options;
  return [...options, { value: trimmed, label: trimmed }];
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function siteMatches(row: DepartmentSectionRow, site: string) {
  return !site || row.site === site;
}

function departmentMatches(row: DepartmentSectionRow, department: string) {
  return canonicalDepartment(row) === department || row.dep === department || row.depEn === department;
}

function canonicalDepartment(row: DepartmentSectionRow) {
  return (row.depEn || row.dep).trim();
}

function canonicalSection(row: DepartmentSectionRow) {
  return (row.secEn || row.sec).trim();
}

function uniqueOptions(options: SelectOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}
