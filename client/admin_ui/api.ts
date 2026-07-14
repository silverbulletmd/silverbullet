import type { FieldError } from "./types.ts";

export async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const resp = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 401) throw { unauthorized: true };
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok)
    throw json.errors ?? [{ field: "", message: `HTTP ${resp.status}` }];
  return json;
}

export function formatApiError(e: unknown): string {
  if (Array.isArray(e)) {
    return e
      .map((fe: FieldError) =>
        fe.field ? `${fe.field}: ${fe.message}` : fe.message,
      )
      .join(", ");
  }
  return "Request failed";
}
