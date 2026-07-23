import { slugify } from "@silverbulletmd/silverbullet/ui";
import type { FieldError } from "./types.ts";

/** Where a space is bound: the server root, or a URL prefix under it. */
export type Hosting = "root" | "prefix";

/** What the administrator step collects. */
export type AdminValues = {
  username: string;
  password: string;
  password2: string;
};

/** What the first-space step collects. */
export type SpaceValues = {
  name: string;
  hosting: Hosting;
  prefix: string;
  folder: string;
};

/** Absolute default folder for a space: `<root>/spaces/<slug-of-name>`. */
export function defaultFolder(root: string, name: string): string {
  const slug = slugify(name);
  const base = root.replace(/\/+$/, "");
  return `${base}/spaces/${slug}`;
}

/** Parent directory of an absolute path, falling back to "/". */
export function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

/**
 * URL the finished space will be served from — also the URL the done step
 * polls while the server hot-swaps into the live multi-space stack. A blank
 * prefix collapses to the root rather than producing `//`.
 */
export function targetUrl(hosting: Hosting, prefix: string): string {
  const normalized = prefix.trim().replace(/^\/+|\/+$/g, "");
  return hosting === "root" || !normalized ? "/" : `/${normalized}/`;
}

/**
 * Validate the administrator step. Returns the first problem found, or an
 * empty array when the step is complete — one at a time, so someone halfway
 * through a form is not handed a wall of errors for fields they have not
 * reached yet.
 */
export function validateAdmin({
  username,
  password,
  password2,
}: AdminValues): FieldError[] {
  if (!username.trim()) {
    return [{ field: "adminUsername", message: "username is required" }];
  }
  if (!password) {
    return [{ field: "adminPassword", message: "password is required" }];
  }
  if (password !== password2) {
    return [{ field: "adminPassword", message: "passwords do not match" }];
  }
  return [];
}

/**
 * Validate the first-space step, one problem at a time (see `validateAdmin`).
 * The prefix is only required when the space is actually bound to one.
 */
export function validateSpace({
  name,
  hosting,
  prefix,
  folder,
}: SpaceValues): FieldError[] {
  if (!name.trim()) {
    return [{ field: "space.name", message: "name is required" }];
  }
  if (hosting === "prefix" && !prefix.trim()) {
    return [{ field: "space.prefix", message: "prefix is required" }];
  }
  if (!folder.trim()) {
    return [{ field: "space.folder", message: "folder is required" }];
  }
  return [];
}

/** The space half of the `api/complete` payload. */
export function spacePayload({ name, hosting, prefix, folder }: SpaceValues): {
  name: string;
  prefix: string;
  folder: string;
} {
  return {
    name,
    prefix: hosting === "root" ? "/" : prefix,
    folder,
  };
}
