import { useEffect, useState } from "preact/hooks";
import type { QueryBuilder } from "./query_builder.ts";

/** Re-renders the caller whenever the builder changes. */
export function useBuilder(builder: QueryBuilder): QueryBuilder {
  const [, setTick] = useState(0);
  useEffect(() => builder.subscribe(() => setTick((t) => t + 1)), [builder]);
  return builder;
}
