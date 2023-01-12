import { Editor } from "../editor.tsx";
import { SysCallMapping } from "../../plugos/system.ts";

import commonSpaceSyscalls from "../../common/syscalls/space.ts";

export function spaceSyscalls(editor: Editor): SysCallMapping {
  const syscalls = commonSpaceSyscalls(editor.space);
  syscalls["space.deletePage"] = async (_ctx, name: string) => {
    // If we're deleting the current page, navigate to the index page
    if (editor.currentPage === name) {
      await editor.navigate("");
    }
    // Remove page from open pages in editor
    editor.openPages.delete(name);
    console.log("Deleting page");
    await editor.space.deletePage(name);
  };
  return syscalls;
}
