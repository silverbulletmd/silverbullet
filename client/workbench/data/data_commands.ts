import type { Client } from "../../client.ts";
import {
  readConfigPage,
  saveSchemaChanges,
} from "../../config_management/config_page.ts";
import { subscribeRefresh } from "../../navigator/page_widget_logic.ts";
import { expandRefreshTriggers } from "../../navigator/refresh_triggers.ts";
import { setNativeBadge } from "../../navigator/ui/native_views.ts";
import { DATA_TAB, WORKBENCH_VIEW } from "../../navigator/views/workbench.ts";
import type { QueryBuilder } from "../query/query_builder.ts";
import { refreshSource } from "../query/query_source.ts";
import { DataModel } from "./data_model.ts";
import { SchemaDrafts } from "./schema/schema_drafts.ts";
import { loadTagSections } from "./tag_list_source.ts";

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The Data tab's model, reading tags from this client. A reload also loads
 * the builder's attributes again, so its query follows the space's data.
 */
export function dataModel(client: Client, builder: QueryBuilder): DataModel {
  return new DataModel({
    loadTags: () => loadTagSections(client),
    // Definitions change on script loads, counts and observed tags on index changes
    subscribeReload: (changed) => {
      const reload = () => {
        changed();
        void refreshSource(client, builder);
      };
      const offLoad = client.clientSystem.spaceLuaEnv.onLoad(reload);
      const offIndex = subscribeRefresh(
        client.clientSystem.eventHook,
        expandRefreshTriggers(["index"]),
        reload,
      );
      client.eventHook.addLocalListener("editor:reloadState", reload);
      return () => {
        offLoad();
        offIndex();
        client.eventHook.removeLocalListener("editor:reloadState", reload);
      };
    },
    storage: browserStorage(),
  });
}

/** The Data tab's unsaved schema edits, reading from and saving to this client. */
export function schemaDrafts(client: Client): SchemaDrafts {
  return new SchemaDrafts({
    load: async () => ({
      configText: await readConfigPage(),
      definitions: client.config.get<Record<string, any>>(["tags"], {}),
      scripts: await client.queryLuaObjects<{
        ref: string;
        page: string;
        script: string;
      }>("space-lua", {}),
      writable:
        !client.bootConfig.readOnly && client.bootConfig.canBuild !== false,
    }),
    save: saveSchemaChanges,
    effective: (tag) => client.config.get(["tags", tag, "schema"], null),
    subscribeReload: (changed) =>
      client.clientSystem.spaceLuaEnv.onLoad(changed),
    onDirty: (dirty) =>
      setNativeBadge(WORKBENCH_VIEW, DATA_TAB, dirty ? "•" : undefined),
  });
}
