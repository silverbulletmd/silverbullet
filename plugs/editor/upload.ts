import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";
import type { UploadFile } from "@silverbulletmd/silverbullet/types";
import {
  defaultLinkStyle,
  maximumAttachmentSize,
} from "../../web/constants.ts";
import { resolvePath } from "@silverbulletmd/silverbullet/lib/resolve";

export async function saveFile(file: UploadFile) {
  const maxSize = await system.getSpaceConfig(
    "maximumAttachmentSize",
    maximumAttachmentSize,
  );
  if (typeof maxSize !== "number") {
    await editor.flashNotification(
      "The setting 'maximumAttachmentSize' must be a number",
      "error",
    );
  }
  if (file.content.length > maxSize * 1024 * 1024) {
    editor.flashNotification(
      `Attachment is too large, maximum is ${maxSize}MiB`,
      "error",
    );
    return;
  }

  const finalFileName = await editor.prompt(
    "File name for pasted attachment",
    file.name,
  );
  if (!finalFileName) {
    return;
  }
  const attachmentPath = resolvePath(
    await editor.getCurrentPage(),
    finalFileName,
  );
  await space.writeAttachment(attachmentPath, file.content);

  const linkStyle = await system.getSpaceConfig(
    "defaultLinkStyle",
    defaultLinkStyle,
  );
  let attachmentMarkdown = "";
  if (linkStyle === "wikilink") {
    attachmentMarkdown = `[[${attachmentPath}]]`;
  } else {
    attachmentMarkdown = `[${finalFileName}](${encodeURI(finalFileName)})`;
  }
  if (file.contentType.startsWith("image/")) {
    attachmentMarkdown = "!" + attachmentMarkdown;
  }
  editor.insertAtCursor(attachmentMarkdown);
}

export async function uploadFile(_ctx: any, accept?: string, capture?: string) {
  const uploadFile = await editor.uploadFile(accept, capture);
  await saveFile(uploadFile);
}
