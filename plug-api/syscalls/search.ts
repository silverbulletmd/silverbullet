import { syscall } from "../syscall.ts";

export function rankObjects(
  objects: any[],
  phrase: string,
  options?: {
    fields?: Record<string, number | { weight: number; segments?: boolean }>;
  },
): Promise<any[]> {
  return syscall("search.rank", objects, phrase, options);
}
