import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getEvidenceFile } from "@/server/disputes/queries";
import { refusalResponse } from "@/server/http";

/** Downloads an evidence file. Always as an attachment, never rendered inline. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await ctx.params;
  const result = await getEvidenceFile(await getCurrentUser(), id, fileId);
  if (!result.ok) return refusalResponse(result.code, result.message);
  const { file, bytes } = result.value;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
    },
  });
}
