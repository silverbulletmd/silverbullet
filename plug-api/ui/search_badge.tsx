import type { IndexReport } from "../types/search_admin.ts";
import { Badge } from "./badge.tsx";
import { spaceBadgeLabel } from "./search_admin_format.ts";
import { spaceBadge } from "./search_admin_model.ts";

/**
 * A space list's badge for a space's search indexes ("Indexing", "Search
 * failed"); nothing while they answer or without any.
 */
export function SearchBadge({ indexes }: { indexes: IndexReport[] }) {
  const label = spaceBadgeLabel(spaceBadge(indexes));
  return label ? <Badge class="sb-space-search-badge">{label}</Badge> : null;
}
