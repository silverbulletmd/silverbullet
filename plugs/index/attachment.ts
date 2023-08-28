import { QueryProviderEvent } from "$sb/app_event.ts";
import { applyQuery } from "$sb/lib/query.ts";
import { space } from "$sb/syscalls.ts";

export async function attachmentQueryProvider({ query }: QueryProviderEvent) {
  return applyQuery(query, await space.listAttachments());
}
