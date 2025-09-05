import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";
import { defaultLinkStyle, maximumDocumentSize } from "../../lib/constants.ts";
import { resolveMarkdownLink } from "@silverbulletmd/silverbullet/lib/resolve";
import {
  encodePageURI,
  isValidPath,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { UploadFile } from "@silverbulletmd/silverbullet/type/client";

export async function saveFile(file: UploadFile) {
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

  const finalFilePath = await editor.prompt(
    "File name for pasted document",
    resolveMarkdownLink(
      await editor.getCurrentPath(),
      isValidPath(file.name)
        ? file.name
        : `file.${
          file.name.indexOf(".") !== -1 ? file.name.split(".").pop() : "txt"
        }`,
    ),
  );
  if (!finalFilePath || !isValidPath(finalFilePath)) {
    return;
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
