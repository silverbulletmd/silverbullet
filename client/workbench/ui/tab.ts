import type { Client } from "../../client.ts";
import type { FocusTarget } from "../../navigator/ui/native_views.ts";
import type { ConsoleSession } from "../console_session.ts";

/** What every Workbench tab body gets. Only the showing tab gets the panel's `focusTarget`. */
export type TabProps = {
  client: Client;
  session: ConsoleSession;
  focusTarget: FocusTarget;
};
