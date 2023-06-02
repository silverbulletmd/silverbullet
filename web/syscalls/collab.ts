import { SysCallMapping } from "../../plugos/system.ts";
import type { Editor } from "../editor.tsx";

export function collabSyscalls(editor: Editor): SysCallMapping {
  return {
    "collab.start": (
      _ctx,
      serverUrl: string,
      token: string,
      username: string,
    ) => {
      editor.startCollab(serverUrl, token, username);
    },
    "collab.stop": (
      _ctx,
    ) => {
      editor.stopCollab(editor.currentPage!);
    },
    "collab.ping": async (
      _ctx,
      clientId: string,
      currentPage: string,
    ) => {
      const resp = await editor.remoteSpacePrimitives.authenticatedFetch(
        editor.remoteSpacePrimitives.url,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "ping",
            clientId,
            page: currentPage,
          }),
        },
      );
      return resp.json();
    },
  };
}
