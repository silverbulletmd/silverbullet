import type { CaptureStore } from "./store.ts";

const maximumShareSize = 100 * 1024 * 1024;
const fieldNames = new Set(["title", "text", "url", "files"]);

export async function refreshShareEligibility(
  store: CaptureStore,
  configUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(configUrl, { cache: "no-store" });
  } catch {
    return;
  }
  const previous = await store.getConfiguration();
  if (!response.ok) {
    if (previous) await store.configure(previous.ownerId, false);
    return;
  }
  try {
    const config = await response.json();
    const ownerId =
      typeof config.shareOwnerId === "string" ? config.shareOwnerId : "";
    await store.configure(
      ownerId,
      !!ownerId &&
        !config.readOnly &&
        !config.enableClientEncryption &&
        !config.disableServiceWorker,
    );
  } catch {
    if (previous) await store.configure(previous.ownerId, false);
  }
}

export function isShareTarget(
  request: Request,
  basePath: string,
  origin: string,
): boolean {
  const url = new URL(request.url);
  return (
    request.method === "POST" &&
    url.origin === origin &&
    url.pathname === `${basePath}/.client/share-target`
  );
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function handleShareTarget(
  request: Request,
  basePath: string,
  store: CaptureStore,
): Promise<Response> {
  const configuration = await store.getConfiguration();
  if (!configuration?.eligible) {
    return errorResponse(403, "This SilverBullet space cannot receive shares.");
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("multipart/form-data")
  ) {
    return errorResponse(415, "The share must use multipart form data.");
  }
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > maximumShareSize) {
    return errorResponse(413, "This share is too large.");
  }
  try {
    const form = await request.formData();
    for (const name of form.keys()) {
      if (!fieldNames.has(name))
        return errorResponse(400, "Unexpected share field.");
    }
    const fields = { title: "", text: "", url: "" };
    for (const name of ["title", "text", "url"] as const) {
      const values = form.getAll(name);
      if (
        values.length > 1 ||
        (values[0] !== undefined && typeof values[0] !== "string")
      ) {
        return errorResponse(400, "Invalid share field.");
      }
      fields[name] = (values[0] as string | undefined) ?? "";
    }
    const values = form.getAll("files");
    if (values.some((value) => !(value instanceof File))) {
      return errorResponse(400, "Invalid shared file.");
    }
    const files = values as File[];
    const textSize = new TextEncoder().encode(
      fields.title + fields.text + fields.url,
    ).byteLength;
    if (
      textSize + files.reduce((sum, file) => sum + file.size, 0) >
      maximumShareSize
    ) {
      return errorResponse(413, "This share is too large.");
    }
    const id = await store.stage(fields, files);
    return new Response(null, {
      status: 303,
      headers: { Location: `${basePath}/?capture=${encodeURIComponent(id)}` },
    });
  } catch {
    return errorResponse(
      507,
      "SilverBullet could not save this share locally.",
    );
  }
}
