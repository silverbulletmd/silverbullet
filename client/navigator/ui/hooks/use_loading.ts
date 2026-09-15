import { useLayoutEffect, useState } from "preact/hooks";
import type { LoadingState } from "../loading.ts";

export function useLoading(state: LoadingState): {
  pending: boolean;
  visible: boolean;
} {
  const [, render] = useState(0);
  useLayoutEffect(() => {
    const changed = () => render((version) => version + 1);
    const unsubscribe = state.subscribe(changed);
    changed();
    return unsubscribe;
  }, [state]);
  return { pending: state.pending, visible: state.visible };
}
