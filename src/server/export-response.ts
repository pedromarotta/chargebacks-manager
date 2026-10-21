import { NextResponse } from "next/server";
import type { Result } from "./errors";
import type { CsvExport } from "./export";
import { refusalResponse } from "./http";

export function csvResponse(result: Result<CsvExport>) {
  if (!result.ok) return refusalResponse(result.code, result.message);
  return new NextResponse(result.value.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.value.filename}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
