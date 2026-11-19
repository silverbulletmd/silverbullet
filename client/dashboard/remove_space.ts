import { adminApi } from "./api.ts";

/** The confirmation asked before removing space `name`. */
export function removeSpacePrompt(
  name: string,
  folder: string | undefined,
  deleteFiles: boolean,
): string {
  if (!deleteFiles) {
    return `Remove "${name}" from the server? Files on disk are kept.`;
  }
  const where = folder ? `its folder "${folder}"` : "its folder";
  return `Remove "${name}" and permanently delete ${where} and every file in it? This cannot be undone.`;
}

/**
 * Removes the space, and with `deleteFiles` its folder too. Resolves to a
 * warning when the space was removed but its folder could not be deleted.
 */
export async function removeSpace(
  id: string,
  deleteFiles: boolean,
): Promise<string | null> {
  const query = deleteFiles ? "?deleteFiles=true" : "";
  const result = await adminApi("DELETE", `spaces/${id}${query}`);
  return result?.warning ?? null;
}
