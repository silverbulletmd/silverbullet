import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";
import {
  defaultLinkStyle,
  maximumDocumentSize,
} from "@silverbulletmd/silverbullet/constants";
import { resolveMarkdownLink } from "@silverbulletmd/silverbullet/lib/resolve";
import {
  encodePageURI,
  isValidPath,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { UploadFile } from "@silverbulletmd/silverbullet/type/client";

function ensureValidFilenameWithExtension(filename: string): string {
  if (isValidPath(filename)) {
    return filename;
  }
  const match = filename.match(/\.([^.]+)$/);
  return `file.${match ? match[1] : "txt"}`;
}

export async function saveFile(file: UploadFile) {
  const invalidPathMessage =
    "Unable to upload file, invalid target filename or path";
  const maxSize = await system.getConfig<number>(
    "maximumDocumentSize",
    maximumDocumentSize,
  );

  if (typeof maxSize !== "number") {
    await editor.flashNotification(
      "The setting 'maximumDocumentSize' must be a number",
      "error",
    );
  }
  if (file.content.length > maxSize * 1024 * 1024) {
    editor.flashNotification(
      `Document is too large, maximum is ${maxSize}MiB`,
      "error",
    );
    return;
  }

  let desiredFilePath = await editor.prompt(
    "File name for uploaded document",
    resolveMarkdownLink(
      await editor.getCurrentPath(),
      ensureValidFilenameWithExtension(file.name),
    ),
  );
  if (desiredFilePath === undefined) {
    // User hit cancel, so they know why we stopped and dont need an notification.
    return;
  }
  desiredFilePath = desiredFilePath.trim();
  if (!isValidPath(desiredFilePath)) {
    await editor.flashNotification(invalidPathMessage, "error");
    return;
  }

  // Check the given desired file path wont clobber an existing file. If it
  // would, ask the user to confirm or provide another filename. Repeat this
  // check for every new filename they give.
  // Note: duplicate any modifications here to client/code_mirror/editor_paste.ts
  let finalFilePath = null;
  while (finalFilePath == null) {
    if (await space.fileExists(desiredFilePath)) {
      let confirmedFilePath = await editor.prompt(
        "A file with that name already exists, keep the same name to replace it, or rename your file",
        resolveMarkdownLink(
          await editor.getCurrentPath(),
          ensureValidFilenameWithExtension(desiredFilePath),
        ),
      );
      if (confirmedFilePath === undefined) {
        // Unlike the initial filename prompt, we're inside a workflow here
        // and should be explicit that the user action cancelled the whole
        // operation.
        editor.flashNotification("Upload cancelled by user", "info");
        return;
      }
      confirmedFilePath = confirmedFilePath.trim();
      if (!isValidPath(confirmedFilePath)) {
        await editor.flashNotification(invalidPathMessage, "error");
        return;
      }
      if (desiredFilePath === confirmedFilePath) {
        // if we got back the same path, we're replacing and should accept the given name
        finalFilePath = desiredFilePath;
      } else {
        // we got a new path, so we must repeat the check
        desiredFilePath = confirmedFilePath;
        confirmedFilePath = undefined;
      }
    } else {
      finalFilePath = desiredFilePath;
    }
  }

  await space.writeDocument(finalFilePath, file.content);

  if (await editor.getCurrentEditor() === "page") {
    const linkStyle = await system.getConfig(
      "defaultLinkStyle",
      defaultLinkStyle,
    );
    let documentMarkdown = "";
    if (linkStyle === "wikilink") {
      documentMarkdown = `[[${finalFilePath}]]`;
    } else {
      documentMarkdown = `[${finalFilePath}](${encodePageURI(finalFilePath)})`;
    }
    if (file.contentType.startsWith("image/")) {
      documentMarkdown = "!" + documentMarkdown;
    }
    editor.insertAtCursor(documentMarkdown);
  }
}

export async function uploadFile(_ctx: any, accept?: string, capture?: string) {
  const uploadFile = await editor.uploadFile(accept, capture);
  await saveFile(uploadFile);
}
