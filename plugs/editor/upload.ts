import { editor, space } from "$sb/silverbullet-syscall/mod.ts";
import { UploadFile } from "$sb/types.ts";

const maximumAttachmentSize = 1024 * 1024 * 10; // 10MB

function folderName(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

async function saveFile(file: UploadFile) {
  if (file.content.length > maximumAttachmentSize) {
    editor.flashNotification(
      `Attachment is too large, maximum is ${
        maximumAttachmentSize / 1024 / 1024
      }MB`,
      "error",
    );
    return;
  }

  let prefix = folderName(await editor.getCurrentPage()) + "/";
  if (prefix === "/") {
    // root folder case
    prefix = "";
  }
  const suggestedName = prefix + file.name;

  const finalFileName = await editor.prompt(
    "File name for pasted attachment",
    suggestedName,
  );
  if (!finalFileName) {
    return;
  }
  await space.writeAttachment(
    finalFileName,
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