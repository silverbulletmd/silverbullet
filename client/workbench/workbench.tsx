import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";
import { shouldFocusModalFilter } from "../lib/mobile.ts";
import {
  type NativeViewProps,
  requestNativeFocus,
} from "../navigator/ui/native_views.ts";
import {
  WORKBENCH_TABS,
  type WorkbenchTab,
} from "../navigator/views/workbench.ts";
import { CodeView } from "./code/code_view.tsx";
import type { ConfigurationModel } from "./configuration/configuration_model.ts";
import { ConfigurationView } from "./configuration/configuration_view.tsx";
import type { ConsoleSession } from "./console/console_session.ts";
import { ConsoleView } from "./console/console_view.tsx";
import type { DataModel } from "./data/data_model.ts";
import { DataView } from "./data/data_view.tsx";
import type { SchemaDrafts } from "./data/schema/schema_drafts.ts";
import type { MaintenanceMonitor } from "./maintenance/maintenance_sources.ts";
import { MaintenanceView } from "./maintenance/maintenance_view.tsx";
import { LibrariesView } from "./libraries/libraries_view.tsx";
import { OverviewView } from "./overview/overview_view.tsx";
import type { QueryBuilder } from "./query/query_builder.ts";
import type { TabProps } from "./tab.ts";

const BODIES: Record<WorkbenchTab, FunctionComponent<TabProps>> = {
  Overview: OverviewView,
  Maintenance: MaintenanceView,
  Console: ConsoleView,
  Code: CodeView,
  Libraries: LibrariesView,
  Configuration: ConfigurationView,
  Data: DataView,
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
  builder,
  maintenance,
  configuration,
  data,
  schemas,
}: NativeViewProps & {
  session: ConsoleSession;
  builder: QueryBuilder;
  maintenance: MaintenanceMonitor;
  configuration: ConfigurationModel;
  data: DataModel;
  schemas: SchemaDrafts;
}) {
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(segmentIndex);
  const noFocus = useCallback(() => () => {}, []);

  // Maintenance's problems and badge load only while the Workbench is open: this
  // body unmounts when the panel closes
  useEffect(() => maintenance.start(), [maintenance]);

  // The navigator restores a view's remembered tab only after its first
  // render (`activation.ts`), so the default tab can take focus and then be
  // hidden. When the hidden tab held focus, hand it to the one now showing;
  // a tab picked in the header keeps focus there. On a touch device that
  // only happens with a keyboard in use, as when the panel itself opens, so a
  // tap never pops up the on-screen keyboard.
  useEffect(() => {
    if (shown.current === segmentIndex) return;
    shown.current = segmentIndex;
    const focused = document.activeElement;
    if (
      shouldFocusModalFilter() &&
      (focused === document.body || root.current?.contains(focused))
    ) {
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
              builder={builder}
              maintenance={maintenance}
              configuration={configuration}
              data={data}
              schemas={schemas}
              focusTarget={showing ? focusTarget : noFocus}
              showing={showing}
            />
          </div>
        );
      })}
    </div>
  );
}
