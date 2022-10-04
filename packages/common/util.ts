import { YAML } from "../../mod.ts";

export function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}

export function isMacLike() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

export function throttle(func: () => void, limit: number) {
  let timer: any = null;
  return function () {
    if (!timer) {
      timer = setTimeout(() => {
        func();
        timer = null;
      }, limit);
    }
  };
}

// TODO: This is naive, may be better to use a proper parser
const yamlSettingsRegex = /```yaml([^`]+)```/;

export function parseYamlSettings(settingsMarkdown: string): {
  [key: string]: any;
} {
  const match = yamlSettingsRegex.exec(settingsMarkdown);
  if (!match) {
    return {};
  }
  const yaml = match[1];
  return YAML.parse(yaml) as {
    [key: string]: any;
  };
}
