import { QueryProviderEvent } from "$sb/app_event.ts";
import { applyQuery } from "$sb/lib/query.ts";
import { space } from "$sb/silverbullet-syscall/mod.ts";

export async function attachmentQueryProvider({ query }: QueryProviderEvent) {
  return applyQuery(query, await space.listAttachments());
}
