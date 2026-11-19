import {
  type GalleryChoice,
  type Starter,
  slugify,
} from "@silverbulletmd/silverbullet/ui";
import { bindingPrefix, validHostAuthority } from "./binding_fields.ts";
import { starterFor } from "./starter_kits.ts";
import type { Binding, FieldError, RevisionsMode } from "./types.ts";

/** What the administrator step collects. */
export type AdminValues = {
  username: string;
  password: string;
  password2: string;
  fullName: string;
  email: string;
};

/** Pre-selected so clicking straight through keeps today's behaviour. */
export const DEFAULT_KIT_ID = "personal-space";

/** The starter half of the first-space step. */
export type StarterValues = {
  choice: GalleryChoice;
  gitUrl: string;
  /** The folder already holds notes, so a kit would be skipped anyway. */
  hasNotes: boolean;
};

export const DEFAULT_STARTER: StarterValues = {
  choice: { type: "kit", id: DEFAULT_KIT_ID },
  gitUrl: "",
  hasNotes: false,
};

/** What the first-space step collects. */
export type SpaceValues = {
  name: string;
  binding: Binding;
  folder: string;
  revisions: RevisionsMode;
  starter: StarterValues;
};

/** The wizard only offers "use as a starting point" for Git, never sync. */
export function wizardStarter({
  choice,
  gitUrl,
  hasNotes,
}: StarterValues): Starter {
  if (choice.type === "kit" && hasNotes) return { type: "none" };
  return starterFor(choice, "copy", gitUrl.trim());
}

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
    return [{ field: "adminUsername", message: "Required" }];
  }
  if (!password) {
    return [{ field: "adminPassword", message: "Required" }];
  }
  if (password !== password2) {
    return [{ field: "adminPassword2", message: "Passwords do not match" }];
  }
  return [];
}

export function validateSpace({
  name,
  binding,
  folder,
  starter,
}: SpaceValues): FieldError[] {
  if (!name.trim()) {
    return [{ field: "space.name", message: "Required" }];
  }
  if (binding.host !== undefined && !binding.host.trim()) {
    return [{ field: "space.host", message: "Required" }];
  }
  if (binding.host !== undefined && !validHostAuthority(binding.host)) {
    return [
      {
        field: "space.host",
        message:
          "Enter an ASCII DNS name or canonical IPv4 address, optionally followed by a port from 1 to 65535",
      },
    ];
  }
  if (binding.prefix !== undefined && !binding.prefix.trim()) {
    return [{ field: "space.prefix", message: "Required" }];
  }
  if (!folder.trim()) {
    return [{ field: "space.folder", message: "Required" }];
  }
  if (starter.choice.type === "git" && !starter.gitUrl.trim()) {
    return [{ field: "space.gitUrl", message: "Required" }];
  }
  return [];
}

/** The space half of the `api/complete` payload. */
export function spacePayload({
  name,
  binding,
  folder,
  revisions,
  starter,
}: SpaceValues) {
  return {
    name,
    ...(binding.host === undefined ? {} : { host: binding.host.trim() }),
    prefix: bindingPrefix(binding),
    folder,
    revisions,
    starter: wizardStarter(starter),
  };
}
