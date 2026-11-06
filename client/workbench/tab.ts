import type { Client } from "../client.ts";
import type { FocusTarget } from "../navigator/ui/native_views.ts";
import type { ConfigurationModel } from "./configuration/configuration_model.ts";
import type { ConsoleSession } from "./console/console_session.ts";
import type { DataModel } from "./data/data_model.ts";
import type { SchemaDrafts } from "./data/schema/schema_drafts.ts";
import type { MaintenanceMonitor } from "./maintenance/maintenance_sources.ts";
import type { QueryBuilder } from "./query/query_builder.ts";

/** What every Workbench tab body gets. Only the showing tab gets the panel's `focusTarget`. */
export type TabProps = {
  client: Client;
  session: ConsoleSession;
  builder: QueryBuilder;
  maintenance: MaintenanceMonitor;
  configuration: ConfigurationModel;
  data: DataModel;
  schemas: SchemaDrafts;
  focusTarget: FocusTarget;
  /** Whether this tab is the one on screen (every tab stays mounted). */
  showing: boolean;
};
