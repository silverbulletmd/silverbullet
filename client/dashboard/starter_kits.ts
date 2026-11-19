import type {
  GalleryChoice,
  KitInfo,
  Starter,
} from "@silverbulletmd/silverbullet/ui";
import { adminApi, api } from "./api.ts";

/** `admin` is the signed-in dashboard; `setup` is the pre-auth wizard. */
export type StarterBase = "admin" | "setup";

const SETUP_ROOT = "/.setup/api/";

function get(base: StarterBase, path: string): Promise<any> {
  return base === "admin"
    ? adminApi("GET", path)
    : api("GET", `${SETUP_ROOT}${path}`);
}

export function listStarterKits(base: StarterBase): Promise<KitInfo[]> {
  return get(base, "starter-kits");
}

export async function folderHasNotes(
  base: StarterBase,
  path: string,
): Promise<boolean> {
  const r = await get(base, `fs/has-notes?path=${encodeURIComponent(path)}`);
  return r.hasNotes === true;
}

export function kitPreviewUrl(
  base: StarterBase,
  kit: Pick<KitInfo, "id" | "hasPreview">,
): string | undefined {
  if (!kit.hasPreview) return undefined;
  const path = `starter-kits/${encodeURIComponent(kit.id)}/preview`;
  return base === "admin" ? `api/admin/${path}` : `${SETUP_ROOT}${path}`;
}

export function starterFor(
  choice: GalleryChoice,
  gitMode: "copy" | "sync",
  gitUrl: string,
): Starter {
  if (choice.type === "kit") {
    return { type: "kit", id: choice.id };
  }
  // Sync is connected by the dashboard after the space exists.
  return gitMode === "sync" ? { type: "none" } : { type: "git", url: gitUrl };
}
