import { syscall } from "./syscall";
import { PageMeta } from "../silverbullet-common/types";

export async function listPages(): Promise<PageMeta[]> {
  return syscall("space.listPages");
}

export async function readPage(
  name: string
): Promise<{ text: string; meta: PageMeta }> {
  return syscall("space.readPage", name);
}

export async function writePage(name: string, text: string): Promise<PageMeta> {
  return syscall("space.writePage", name, text);
}

export async function deletePage(name: string): Promise<PageMeta> {
  return syscall("space.deletePage", name);
}
