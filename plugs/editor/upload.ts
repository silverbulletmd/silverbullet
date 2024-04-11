import { readSetting } from "$sb/lib/settings_page.ts";
import { editor, space } from "$sb/syscalls.ts";
import { UploadFile } from "../../plug-api/types.ts";
import { maximumAttachmentSize } from "../../web/constants.ts";


function folderName(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

async function saveFile(file: UploadFile) {
  const maxSize = await readSetting("maximumAttachmentSize", maximumAttachmentSize);
  if (typeof maxSize !== "number") {
    await editor.flashNotification(
      "The setting 'maximumAttachmentSize' must be a number", "error");
  }
  if (file.content.length > maxSize * 1024 * 1024) {
    editor.flashNotification(
      `Attachment is too large, maximum is ${maxSize}MiB`,
      "error",
    );
    return;
  }

  let prefix = folderName(await editor.getCurrentPage()) + "/";
  if (prefix === "/") {
    // root folder case
    prefix = "";
  }

  const finalFileName = await editor.prompt(
    "File name for pasted attachment",
    file.name,
  );
  if (!finalFileName) {
    return;
  }
  await space.writeAttachment(
    prefix + finalFileName,
    file.content,
  );
  let attachmentMarkdown = `[${finalFileName}](${encodeURI(finalFileName)})`;
  if (file.contentType?.startsWith("image/")) {
    attachmentMarkdown = `![](${encodeURI(finalFileName)})`;
  }
  editor.insertAtCursor(attachmentMarkdown);
}

export async function uploadFile(_ctx: any, accept?: string, capture?: string) {
  const uploadFile = await editor.uploadFile(accept, capture);
  await saveFile(uploadFile);
}
