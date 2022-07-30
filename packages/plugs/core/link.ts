import { nodeAtPos } from "@silverbulletmd/common/tree";
import {
  filterBox,
  flashNotification,
  getCursor,
  getText,
  replaceRange,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { dispatch as dispatchEvent } from "@plugos/plugos-syscall/event";
import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";

type UnfurlOption = {
  id: string;
  name: string;
};

export async function unfurlCommand() {
  let mdTree = await parseMarkdown(await getText());
  let nakedUrlNode = nodeAtPos(mdTree, await getCursor());
  let url = nakedUrlNode!.children![0].text!;
  console.log("Got URL to unfurl", url);
  let optionResponses = await dispatchEvent("unfurl:options", url);
  let options: UnfurlOption[] = [];
  for (let resp of optionResponses) {
    options.push(...resp);
  }
  let selectedUnfurl: any = await filterBox(
    "Unfurl",
    options,
    "Select the unfurl strategy of your choice"
  );
  if (!selectedUnfurl) {
    return;
  }
  try {
    let replacement = await invokeFunction(
      "server",
      "unfurlExec",
      selectedUnfurl.id,
      url
    );
    await replaceRange(nakedUrlNode?.from!, nakedUrlNode?.to!, replacement);
  } catch (e: any) {
    await flashNotification(e.message, "error");
  }
}

export async function titleUnfurlOptions(url: string): Promise<UnfurlOption[]> {
  return [
    {
      id: "title-unfurl",
      name: "Extract title",
    },
  ];
}

// Run on the server because plugs will likely rely on fetch for this
export async function unfurlExec(id: string, url: string): Promise<string> {
  let replacement = await dispatchEvent(`unfurl:${id}`, url);
  return replacement[0];
}

const titleRegex = /<title[^>]*>\s*([^<]+)\s*<\/title\s*>/i;

export async function titleUnfurl(url: string): Promise<string> {
  let response = await fetch(url);
  if (response.status < 200 || response.status >= 300) {
    console.error("Unfurl failed", await response.text());
    throw new Error(`Failed to fetch: ${await response.statusText}`);
  }
  let body = await response.text();
  let match = titleRegex.exec(body);
  if (match) {
    return `[${match[1]}](${url})`;
  } else {
    throw new Error("No title found");
  }
}
