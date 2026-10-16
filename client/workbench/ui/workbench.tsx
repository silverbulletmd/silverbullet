import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";
import {
  type NativeViewProps,
  requestNativeFocus,
} from "../../navigator/ui/native_views.ts";
import {
  WORKBENCH_TABS,
  type WorkbenchTab,
} from "../../navigator/views/workbench.ts";
import type { ConsoleSession } from "../console_session.ts";
import { ConsoleView } from "./console_view.tsx";
import { ScriptsView } from "./scripts_view.tsx";
import type { TabProps } from "./tab.ts";

const BODIES: Record<WorkbenchTab, FunctionComponent<TabProps>> = {
  Console: ConsoleView,
  Scripts: ScriptsView,
};

/**
 * The Workbench body. Every tab stays mounted, so switching keeps a tab's
 * state (the REPL's draft, scroll positions); only the showing one gets the
 * panel's focus target.
 */
export function WorkbenchView({
  client,
  slot,
  segmentIndex,
  focusTarget,
  session,
}: NativeViewProps & { session: ConsoleSession }) {
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(segmentIndex);
  const noFocus = useCallback(() => () => {}, []);

  // The navigator restores a view's remembered tab only after its first
  // render (`activation.ts`), so the default tab can take focus and then be
  // hidden. When the hidden tab held focus, hand it to the one now showing;
  // a tab picked in the header keeps focus there.
  useEffect(() => {
    if (shown.current === segmentIndex) return;
    shown.current = segmentIndex;
    const focused = document.activeElement;
    if (focused === document.body || root.current?.contains(focused)) {
      requestNativeFocus(slot);
    }
  }, [segmentIndex, slot]);

  return (
    <div className="sb-wb-tabs" ref={root}>
      {WORKBENCH_TABS.map((name, i) => {
        const Body = BODIES[name];
        const showing = i === segmentIndex;
        return (
          <div key={name} className="sb-wb-tab" hidden={!showing}>
            <Body
              client={client}
              session={session}
              focusTarget={showing ? focusTarget : noFocus}
            />
          </div>
        );
      })}
    </div>
  );
}
