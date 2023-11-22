import { editor, space } from "$sb/silverbullet-syscall/mod.ts";
import { UploadFile } from "../../plug-api/types";

const maximumAttachmentSize = 1024 * 1024 * 10; // 10MB

function folderName(path: string) {
    return path.split("/").slice(0, -1).join("/");
}

async function saveFile(file: UploadFile) {
    if (file.content.length > maximumAttachmentSize) {
        editor.flashNotification(
            `Attachment is too large, maximum is ${maximumAttachmentSize / 1024 / 1024
            }MB`,
            "error",
        );
        return;
    }

    const suggestedName = folderName(await editor.getCurrentPage()) + "/" + file.name;
    console.log(suggestedName)

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
    if (file.type.startsWith("image/")) {
        attachmentMarkdown = `![](${encodeURI(finalFileName)})`;
    }
    editor.insertAtCursor(attachmentMarkdown);
}

export async function uploadFile() {
    const uploadFile = await editor.uploadFile();
    await saveFile(uploadFile);
}