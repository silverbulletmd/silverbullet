import {
  defaultFontLabel,
  type FontEntry,
  fontSelectionFor,
  installFonts,
  parseFontValue,
  usableEntry,
} from "@silverbulletmd/silverbullet/lib/fonts";
import type { ThemeInfo } from "@silverbulletmd/silverbullet/lib/themes";
import { Input, Select } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import type { Client } from "../../client.ts";
import type { TypedField } from "./options_section.tsx";

const CUSTOM = "\u0000custom";

const GROUPS: [FontEntry["kind"], string][] = [
  ["sans", "Sans"],
  ["serif", "Serif"],
  ["mono", "Mono"],
];

/**
 * Previews the `fonts.*` settings as Configuration currently holds them,
 * including a value still being typed; Escape or a reset takes the preview
 * back, and saving makes it stick.
 */
export function useFontPreview(
  client: Client,
  valueOf: (path: string) => unknown,
): void {
  const theme = useActiveTheme(client);
  const editor = valueOf("fonts.editor") as string | undefined;
  const code = valueOf("fonts.code") as string | undefined;
  const editorSize = valueOf("fonts.editorSize") as number | undefined;
  useEffect(() => {
    const available = client.config.get<Record<string, FontEntry>>(
      "fonts.available",
      {},
    );
    installFonts(
      fontSelectionFor({ editor, code, editorSize, available }, theme?.fonts),
    );
  }, [editor, code, editorSize, theme]);
}

/** The theme on screen, a preview included, kept current. */
function useActiveTheme(client: Client): ThemeInfo | undefined {
  const [theme, setTheme] = useState(client.spaceTheme.active);
  useEffect(() => {
    setTheme(client.spaceTheme.active);
    return client.spaceTheme.onChange(setTheme);
  }, [client]);
  return theme;
}

/** The editor size field; unset, it shows the size in effect. */
export function EditorSizeInput(props: {
  client: Client;
  value: number | undefined;
  label: string;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
  typed: TypedField;
}) {
  const theme = useActiveTheme(props.client);
  return (
    <Input
      aria-label={props.label}
      disabled={props.disabled}
      type="number"
      placeholder={String(theme?.fonts?.editorSize ?? 18)}
      value={props.value == null ? "" : String(props.value)}
      onInput={(e) => {
        const v = e.currentTarget.value;
        props.onChange(v === "" ? undefined : Number(v));
      }}
      {...props.typed}
    />
  );
}

/**
 * A `fonts.*` setting: a font from `fonts.available`, the default, or a
 * custom CSS font-family. The code font offers monospace fonts only.
 */
export function FontSelect(props: {
  client: Client;
  value: string | undefined;
  slot: "editor" | "code";
  label: string;
  disabled: boolean;
  /** A font picked from the list */
  onChange: (value: string | undefined) => void;
  /** A custom font-family as it is typed */
  onType: (value: string | undefined) => void;
  typed: TypedField;
}) {
  const available = props.client.config.get<Record<string, FontEntry>>(
    "fonts.available",
    {},
  );
  const value = props.value ?? "";
  // Custom is a mode, not a value: picking it starts from an empty field.
  const [customMode, setCustomMode] = useState(false);
  const isCustom =
    customMode || (value !== "" && !usableEntry(available, value));
  const theme = useActiveTheme(props.client);
  const groups = GROUPS.filter(
    ([kind]) => props.slot !== "code" || kind === "mono",
  );
  return (
    <div className="sb-wb-cfg-font">
      <Select
        aria-label={props.label}
        disabled={props.disabled}
        value={isCustom ? CUSTOM : value}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setCustomMode(v === CUSTOM);
          if (v !== CUSTOM) props.onChange(v === "" ? undefined : v);
        }}
      >
        <option value="">
          {defaultFontLabel(available, props.slot, theme)}
        </option>
        {groups.map(([kind, title]) => {
          const fonts = Object.entries(available).filter(
            ([key, f]) => usableEntry(available, key) && f.kind === kind,
          );
          if (fonts.length === 0) return null;
          return (
            <optgroup key={kind} label={title}>
              {fonts.map(([key, f]) => (
                <option key={key} value={key} style={{ fontFamily: f.family }}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          );
        })}
        <option value={CUSTOM}>Custom…</option>
      </Select>
      {isCustom && (
        <Input
          aria-label={`${props.label}, CSS font-family`}
          disabled={props.disabled}
          placeholder="e.g. Georgia, serif"
          value={value}
          onInput={(e) => props.onType(e.currentTarget.value || undefined)}
          {...props.typed}
        />
      )}
      {isCustom &&
        value &&
        parseFontValue(value, available).type !== "stack" && (
          <div className="sb-wb-cfg-font-hint sb-wb-muted">
            Not used as written. Add a fallback, such as “{value.split(",")[0]},
            serif”, and use letters, spaces, commas, quotes and hyphens only.
          </div>
        )}
    </div>
  );
}
