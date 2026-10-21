import type { Client } from "../client.ts";
import type { FocusTarget } from "../navigator/ui/native_views.ts";
import type { ConsoleSession } from "./console/console_session.ts";
import type { HealthMonitor } from "./health/health_sources.ts";
import type { QueryBuilder } from "./query/query_builder.ts";

/** What every Workbench tab body gets. Only the showing tab gets the panel's `focusTarget`. */
export type TabProps = {
  client: Client;
  session: ConsoleSession;
  builder: QueryBuilder;
  health: HealthMonitor;
  focusTarget: FocusTarget;
  /** Whether this tab is the one on screen (every tab stays mounted). */
  showing: boolean;
};
