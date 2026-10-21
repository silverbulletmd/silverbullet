import type { Client } from "../../client.ts";
import {
  ContentNode,
  useRenderedValue,
} from "../../navigator/ui/components/content_view.tsx";
import { ValueTree } from "./value_tree.tsx";

/**
 * A value rendered the way `${…}` renders it on a page: query results as
 * tables, widgets as widgets. Falls back to the Lua view while rendering,
 * and when the value renders to nothing.
 */
export function RenderedValue({
  client,
  value,
}: {
  client: Client;
  value: unknown;
}) {
  const { content } = useRenderedValue(client, value, client.currentName());
  if (content?.error !== undefined) {
    return (
      <span className="sb-wb-render-error" title={content.error}>
        <ValueTree value={value} client={client} />
      </span>
    );
  }
  if (!content?.node) return <ValueTree value={value} client={client} />;
  return (
    <div className="sb-wb-rendered">
      <ContentNode
        client={client}
        node={content.node}
        cssClasses={content.cssClasses}
        events={content.events}
      />
    </div>
  );
}
