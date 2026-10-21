export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** POSTs JSON to our API and returns either the data or a plain-language refusal message. */
export async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: json as T };
    const message =
      json && typeof json === "object" && "error" in json && typeof (json as { error: { message?: unknown } }).error?.message === "string"
        ? (json as { error: { message: string } }).error.message
        : "Something went wrong. Try again.";
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Couldn't reach the server. Check your connection and try again." };
  }
}
