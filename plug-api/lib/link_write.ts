import { config } from "../syscalls.ts";
import { getNameFromPath, type Path } from "./ref.ts";
import {
  type LinkWriteFormat,
  type PathIndex,
  writeLinkPath,
} from "./resolve_path.ts";

/**
 * The space's configured link write format — the one place its config key and
 * default live. Plug-side only (reads config through a syscall).
 */
export function linkWriteFormat(): Promise<LinkWriteFormat> {
  return config.get<LinkWriteFormat>("linkWriteFormat", "full-path");
}

/**
 * Renders a page path as the link text SilverBullet writes for it under the
 * given format.
 */
export function writtenLinkText(
  path: Path,
  format: LinkWriteFormat,
  index: PathIndex,
): string {
  return getNameFromPath(writeLinkPath(path, format, index));
}
