import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { attachEvidenceFile } from "@/server/disputes/service";
import { MAX_FILE_BYTES } from "@/server/files";
import { refusalResponse } from "@/server/http";

/** Multipart upload of one evidence file: fields `key` (evidence item) and `file`. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send the file as multipart/form-data." } }, { status: 415 });
  }
  // A cross-site form can't set custom headers, so this blocks forged uploads (the JSON routes rely on 415 instead).
  if (req.headers.get("x-cbm-upload") !== "1") {
    return NextResponse.json({ error: { code: "UPLOAD_HEADER_REQUIRED", message: "Upload files from the case page." } }, { status: 403 });
  }
  const actor = await getCurrentUser();
  if (!actor) {
    console.warn(`[auth] 401 POST ${new URL(req.url).pathname}`);
    return refusalResponse("UNAUTHENTICATED");
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "The file is larger than 5 MB." } }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refusalResponse("INVALID_INPUT", "The upload couldn't be read.");
  }
  const key = form.get("key");
  const file = form.get("file");
  const input =
    file instanceof File
      ? { key: typeof key === "string" ? key : "", filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
      : { key };
  const result = await attachEvidenceFile(actor, id, input);
  if (result.ok) return NextResponse.json({ file: result.value });
  return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.httpStatus });
}
