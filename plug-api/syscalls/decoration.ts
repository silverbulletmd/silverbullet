import { PageMeta } from "$sb/types.ts";

export function applyDecorationsToPages(
    pages: PageMeta[],
): Promise<PageMeta[]> {
    return syscall("decoration.applyDecorationsToPages", pages);
}
