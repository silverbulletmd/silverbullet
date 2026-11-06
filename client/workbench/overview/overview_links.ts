/**
 * Where each element of the Overview tab leads: the place you'd act on what
 * it shows, and the one function that follows a link.
 */
import { type Path, parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import * as Constants from "../../../plugs/index/constants.ts";
import type { Client } from "../../client.ts";
import { showView } from "../../navigator/navigator.ts";
import type { QueryBuilder } from "../query/query_builder.ts";
import { type QuerySource, sourceFor } from "../query/query_from.ts";
import { withOperator } from "../query/query_ops.ts";
import { parseQuery, querySource } from "../query/query_parse.ts";
import { loadAttributes } from "../query/query_source.ts";
import { openRef } from "../shared/action.ts";
import { openWorkbench, type WorkbenchTarget } from "../workbench_target.ts";

export type OverviewLink =
  | { kind: "query"; tag: string }
  | { kind: "tasks"; done: boolean }
  | { kind: "queryText"; expr: string }
  | { kind: "workbench"; target: WorkbenchTarget }
  | { kind: "view"; view: string }
  | { kind: "page"; page: string }
  | { kind: "tagPage"; tag: string };

/** Tag objects are one per page and tag; selecting only the name lists each tag once */
export const ALL_TAGS_QUERY = `query[[
  from t = index.tags()
  select {
    name = t.name
  }
]]`;

export const LINKS = {
  pages: { kind: "query", tag: "page" },
  tasksOpen: { kind: "tasks", done: false },
  tasksDone: { kind: "tasks", done: true },
  links: { kind: "query", tag: "relation" },
  documents: { kind: "query", tag: "document" },
  allTags: { kind: "queryText", expr: ALL_TAGS_QUERY },
  spaceLog: { kind: "view", view: "std.spaceLog" },
  gitStatus: { kind: "view", view: "std.gitStatus" },
  maintenance: { kind: "workbench", target: { tab: "Maintenance" } },
  scripts: { kind: "workbench", target: { tab: "Code", section: "lua" } },
  styles: { kind: "workbench", target: { tab: "Code", section: "style" } },
} satisfies Record<string, OverviewLink>;

const SHOW_QUERY: WorkbenchTarget = { tab: "Data", view: "objects" };

export async function followOverviewLink(
  client: Client,
  builder: QueryBuilder,
  link: OverviewLink,
): Promise<void> {
  switch (link.kind) {
    case "workbench":
      return openWorkbench(link.target);
    case "view":
      return showView(link.view);
    case "page":
      return openRef(client, { path: `${link.page}.md` as Path });
    case "tagPage": {
      // Same target a #hashtag in the editor opens
      const page =
        client.config.get<string | null>(["tags", link.tag, "tagPage"], null) ??
        Constants.tagPrefix + link.tag;
      const ref = parseToRef(page);
      if (ref) return openRef(client, ref);
      return;
    }
    case "queryText": {
      builder.setTarget(null);
      const source = querySource(link.expr);
      if (!source) return;
      const { attributes } = await loadAttributes(client, source);
      const parsed = parseQuery(link.expr, attributes);
      if (!parsed.ok) return;
      builder.openModel(parsed.model, attributes);
      return openWorkbench(SHOW_QUERY);
    }
    case "query":
      await browse(client, builder, sourceFor(link.tag));
      return openWorkbench(SHOW_QUERY);
    case "tasks": {
      await browse(client, builder, sourceFor("task"));
      const done = withOperator("done", "boolean", String(link.done), "");
      builder.update((m) => ({
        ...m,
        filters: [done],
        select: { mode: "list", list: { template: "templates.taskItem" } },
      }));
      return openWorkbench(SHOW_QUERY);
    }
  }
}

/** Starts the builder over on `source`, quietly: following a link isn't losing work. */
async function browse(
  client: Client,
  builder: QueryBuilder,
  source: QuerySource,
): Promise<void> {
  // Browsing, not inserting: an abandoned /Query… or "Edit query" target must not survive
  builder.setTarget(null);
  const { attributes } = await loadAttributes(client, source);
  builder.pickSource(source, attributes);
}
