import { Button, Select } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Client } from "../../client.ts";
import {
  deviceThemeNote,
  missingThemeOption,
  previewPage,
  themeGroups,
  UNSET_THEME_LABEL,
} from "./theme_options.ts";

/**
 * The space's `theme` setting. Choosing one shows it here, on this device,
 * until it is saved or discarded or the tab is left.
 */
export function ThemeSelect(props: {
  client: Client;
  value: string | undefined;
  /** The saved setting, which a preview is measured against. */
  saved: string | undefined;
  /** Whether the Configuration tab is on screen; a hidden tab doesn't preview. */
  showing: boolean;
  label: string;
  disabled: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const { client, value, saved, showing } = props;
  const themes = client.tooling?.themes ?? [];
  const groups = themeGroups(themes);
  const [override, setOverride] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    const read = () =>
      client.spaceTheme
        .deviceTheme()
        .then((page) => live && setOverride(page))
        .catch((e) => console.error("Could not read this device's theme", e));
    void read();
    // Theme: Select and Toggle change the override while this is open
    const off = client.spaceTheme.onChange(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [client, showing]);

  const previewed = useRef(false);
  useEffect(() => {
    const page = previewPage(
      showing,
      value,
      saved,
      themes,
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
    if (page !== undefined) {
      previewed.current = true;
      client.spaceTheme.preview({ page });
    } else if (previewed.current) {
      previewed.current = false;
      // After a save the reload's apply() may still be running: resolve first
      void client.spaceTheme
        .apply()
        .catch((e) => console.error("Could not apply theme", e))
        .then(() => client.spaceTheme.preview({ page: undefined }));
    }
  }, [client, value, saved, showing]);

  useEffect(
    () => () => client.spaceTheme.preview({ page: undefined }),
    [client],
  );

  const missing = missingThemeOption(value, themes);
  const note = deviceThemeNote(override, themes, value !== saved);
  return (
    <div className="sb-wb-cfg-theme">
      <Select
        aria-label={props.label}
        disabled={props.disabled}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.currentTarget.value;
          props.onChange(v === "" ? undefined : v);
        }}
      >
        {missing && <option value={missing.value}>{missing.label}</option>}
        <option value="">{UNSET_THEME_LABEL}</option>
        {(
          [
            ["Light", groups.light],
            ["Dark", groups.dark],
          ] as const
        ).map(
          ([title, list]) =>
            list.length > 0 && (
              <optgroup key={title} label={title}>
                {list.map((t) => (
                  <option key={t.page} value={t.page}>
                    {t.displayName}
                  </option>
                ))}
              </optgroup>
            ),
        )}
      </Select>
      {note && (
        <div className="sb-wb-cfg-theme-note">
          <span>{note}</span>
          <Button
            onClick={() => {
              setOverride(undefined);
              client.spaceTheme
                .setDeviceTheme(undefined)
                .catch((e) =>
                  console.error("Could not clear this device's theme", e),
                );
            }}
          >
            Use space default
          </Button>
        </div>
      )}
    </div>
  );
}
