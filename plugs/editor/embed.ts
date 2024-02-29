import { YAML } from "$sb/syscalls.ts";
import type { WidgetContent } from "../../plug-api/types.ts";

type EmbedConfig = {
  url: string;
  height?: number;
  width?: number;
};

export function extractYoutubeVideoId(url: string) {
  let match = url.match(/youtube\.com\/watch\?v=([^&]+)/);
  if (match) {
    return match[1];
  }
  match = url.match(/youtu.be\/([^&]+)/);
  if (match) {
    return match[1];
  }

  return null;
}

export async function embedWidget(
  bodyText: string,
): Promise<WidgetContent> {
  try {
    const data: EmbedConfig = await YAML.parse(bodyText) as any;
    let url = data.url;
    const youtubeVideoId = extractYoutubeVideoId(url);
    if (youtubeVideoId) {
      url = `https://www.youtube.com/embed/${youtubeVideoId}`;
      // Sensible video defaults
      data.width = data.width || 560;
      data.height = data.height || 315;
    }
    return {
      url,
      height: data.height,
      width: data.width,
    };
  } catch (e: any) {
    return {
      html: `ERROR: Could not parse body as YAML: ${e.message}`,
      script: "",
    };
  }
}
