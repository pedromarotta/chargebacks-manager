import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import type { Actor } from "./domain";
import { refusal, type Result } from "./errors";

function refusalResponse(code: Parameters<typeof refusal>[0], message?: string) {
  const r = refusal(code, message);
  return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.httpStatus });
}

/**
 * Shared API plumbing: JSON only (blocks cross-site form posts), 401 without a valid
 * session, then hands the parsed body to the service and maps its Result to HTTP.
 */
export async function handleJson<T>(
  req: Request,
  run: (actor: Actor, body: unknown) => Promise<Result<T>>,
): Promise<NextResponse> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send the request as JSON." } },
      { status: 415 },
    );
  }
  const actor = await getCurrentUser();
  if (!actor) {
    console.warn(`[auth] 401 ${req.method} ${new URL(req.url).pathname}`);
    return refusalResponse("UNAUTHENTICATED");
  }
  const text = await req.text();
  let body: unknown = undefined;
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return refusalResponse("INVALID_INPUT", "The request body isn't valid JSON.");
    }
  }
  const result = await run(actor, body);
  if (result.ok) return NextResponse.json(result.value);
  return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.httpStatus });
}

export function notFound() {
  return refusalResponse("NOT_FOUND", "Not found.");
}
