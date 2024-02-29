import { nodeAtPos } from "../../plug-api/lib/tree.ts";
import { editor, events, markdown } from "$sb/syscalls.ts";
import { extractYoutubeVideoId } from "./embed.ts";

type UnfurlOption = {
  id: string;
  name: string;
};

export async function unfurlCommand() {
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  const cursorPos = await editor.getCursor();
  let nakedUrlNode = nodeAtPos(mdTree, cursorPos);
  if (nakedUrlNode?.type !== "NakedURL") {
    nakedUrlNode = nodeAtPos(mdTree, cursorPos - 1);
  }
  if (nakedUrlNode?.type !== "NakedURL") {
    await editor.flashNotification("No URL found under cursor", "error");
    return;
  }
  const url = nakedUrlNode!.children![0].text!;
  console.log("Got URL to unfurl", url);
  const optionResponses = await events.dispatchEvent("unfurl:options", url);
  const options: UnfurlOption[] = [];
  for (const resp of optionResponses) {
    options.push(...resp);
  }
  const selectedUnfurl: any = await editor.filterBox(
    "Unfurl",
    options,
    "Select the unfurl strategy of your choice",
  );
  if (!selectedUnfurl) {
    return;
  }
  try {
    const replacement = await events.dispatchEvent(
      `unfurl:${selectedUnfurl.id}`,
      url,
    );
    if (replacement.length === 0) {
      throw new Error("Unfurl failed");
    }
    await editor.replaceRange(
      nakedUrlNode?.from!,
      nakedUrlNode?.to!,
      replacement[0],
    );
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}

export function titleUnfurlOptions(): UnfurlOption[] {
  return [
    {
      id: "title-unfurl",
      name: "Extract title",
    },
  ];
}

const titleRegex = /<title[^>]*>\s*([^<]+)\s*<\/title\s*>/i;

export async function titleUnfurl(url: string): Promise<string> {
  const response = await fetch(url);
  if (response.status < 200 || response.status >= 300) {
    console.error("Unfurl failed", await response.text());
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }
  const body = await response.text();
  const match = titleRegex.exec(body);
  if (match) {
    return `[${match[1]}](${url})`;
  } else {
    throw new Error("No title found");
  }
}

export function youtubeUnfurlOptions(url: string): UnfurlOption[] {
  if (extractYoutubeVideoId(url)) {
    return [
      {
        id: "youtube-unfurl",
        name: "Embed video",
      },
    ];
  } else {
    return [];
  }
}

export function youtubeUnfurl(url: string): string {
  return "```embed\nurl: " + url + "\n```";
}
