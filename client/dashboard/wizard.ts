import { slugify } from "@silverbulletmd/silverbullet/ui";
import { bindingPrefix, validHostAuthority } from "./binding_fields.ts";
import type { Binding, FieldError, RevisionsMode } from "./types.ts";

/** What the administrator step collects. */
export type AdminValues = {
  username: string;
  password: string;
  password2: string;
  fullName: string;
  email: string;
};

/** What the first-space step collects. */
export type SpaceValues = {
  name: string;
  binding: Binding;
  folder: string;
  revisions: RevisionsMode;
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

export function validateSpace({
  name,
  binding,
  folder,
}: SpaceValues): FieldError[] {
  if (!name.trim()) {
    return [{ field: "space.name", message: "name is required" }];
  }
  if (binding.host !== undefined && !binding.host.trim()) {
    return [{ field: "space.host", message: "hostname is required" }];
  }
  if (binding.host !== undefined && !validHostAuthority(binding.host)) {
    return [
      {
        field: "space.host",
        message:
          "enter an ASCII DNS name or canonical IPv4 address, optionally followed by a port from 1 to 65535",
      },
    ];
  }
  if (binding.prefix !== undefined && !binding.prefix.trim()) {
    return [{ field: "space.prefix", message: "prefix is required" }];
  }
  if (!folder.trim()) {
    return [{ field: "space.folder", message: "folder is required" }];
  }
  return [];
}

/** The space half of the `api/complete` payload. */
export function spacePayload({
  name,
  binding,
  folder,
  revisions,
}: SpaceValues) {
  return {
    name,
    ...(binding.host === undefined ? {} : { host: binding.host.trim() }),
    prefix: bindingPrefix(binding),
    folder,
    revisions,
  };
}
