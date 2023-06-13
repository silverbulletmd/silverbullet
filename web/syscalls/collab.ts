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
      editor.stopCollab();
    },
  };
}
