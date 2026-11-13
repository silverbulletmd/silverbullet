import type { ThemeInfo } from "@silverbulletmd/silverbullet/lib/themes";
import type { Client } from "../../client.ts";
import type { SysCallMapping } from "../system.ts";

function themeList(client: Client): ThemeInfo[] {
  return client.tooling?.themes ?? [];
}

/** Plain objects, so Lua sees tables and no optional field is a key holding nil. */
function plain(t: ThemeInfo): ThemeInfo {
  return JSON.parse(JSON.stringify(t));
}

export function themeSyscalls(client: Client): SysCallMapping {
  return {
    "theme.list": {
      callback: (): ThemeInfo[] => themeList(client).map(plain),
      description:
        "Lists all installed themes: pages tagged meta/theme with a valid scheme.",
      returns: [
        {
          type: "table[]",
          description:
            "Themes with `page`, `displayName`, `scheme` (`light` or `dark`) and, when set, `description`, `counterpart` and `fonts`.",
        },
      ],
      examples: [
        {
          code: "for _, t in ipairs(theme.list()) do print(t.displayName, t.scheme) end",
        },
      ],
    },
    "theme.getActive": {
      callback: (): ThemeInfo => {
        const active = client.spaceTheme.active;
        if (!active) throw new Error("No theme is active yet");
        return plain(active);
      },
      description:
        "Returns the theme currently on screen: this device's override, else the space's `theme` setting, else a built-in chosen by the system's light or dark preference. While the Configuration tab previews a theme, it returns the previewed one, and the theme commands see that one too.",
      returns: [{ type: "table", description: "The active theme." }],
      examples: [{ code: "print(theme.getActive().displayName)" }],
    },
    "theme.getDeviceTheme": {
      callback: (): Promise<string | undefined> =>
        client.spaceTheme.deviceTheme(),
      description: "Gets the page of this device's theme override, if any.",
      returns: [
        { type: "string?", description: "Theme page, or nil when unset." },
      ],
      examples: [{ code: "local page = theme.getDeviceTheme()" }],
    },
    "theme.setDeviceTheme": {
      callback: (_ctx, page?: string): Promise<void> =>
        client.spaceTheme.setDeviceTheme(page),
      description:
        "Overrides the theme on this device only and applies it immediately. Pass nil to clear the override and follow the space's setting again. Errors when no installed theme has that page name.",
      parameters: [
        {
          name: "page",
          type: "string",
          description: "Page name of the theme, or nil to clear the override.",
          optional: true,
        },
      ],
      examples: [
        {
          code: 'theme.setDeviceTheme("Library/Std/Themes/SilverBullet Dark")',
        },
        { code: "theme.setDeviceTheme(nil)" },
      ],
    },
  };
}
