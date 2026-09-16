import { render } from "preact";
import type { Client } from "../../../client.ts";
import { luaHandle } from "../../lua_views.ts";
import type { ViewValue } from "../../view_value.ts";
import { inlineExpansionKey } from "../expansion.ts";
import { DocumentView, type DocumentDispatch } from "./document_view.tsx";

export function mountInlineView(
  host: HTMLElement,
  client: Client,
  value: ViewValue,
  pageName: string,
): () => void {
  const dispatch: DocumentDispatch = (hook, args) =>
    luaHandle(value.spec, hook, args, client.clientSystem.spaceLuaEnv.env);
  render(
    <DocumentView
      meta={value.meta}
      client={client}
      pageName={pageName}
      dock="inline"
      dispatch={dispatch}
      selectable={value.selectable}
      persistenceKey={inlineExpansionKey(
        pageName,
        value.stateKey,
        value.meta.expandAll,
      )}
    />,
    host,
  );
  return () => render(null, host);
}
