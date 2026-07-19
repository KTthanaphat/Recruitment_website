import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { parseDepartmentSectionCsv } from "@/lib/department-section-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const csv = await readFile(path.join(process.cwd(), "dep_sec_data.csv"), "utf8");
  return NextResponse.json(parseDepartmentSectionCsv(csv));
}
