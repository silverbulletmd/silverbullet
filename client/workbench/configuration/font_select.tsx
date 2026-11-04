import { Input, Select } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import type { Client } from "../../client.ts";
import {
  applyFontStylesheet,
  baseOf,
  DEFAULT_FONT,
  type FontEntry,
  fontSelectionFor,
  fontStylesheet,
  parseFontValue,
  usableEntry,
} from "@silverbulletmd/silverbullet/lib/fonts";

const CUSTOM = "\u0000custom";

const GROUPS: [FontEntry["kind"], string][] = [
  ["sans", "Sans"],
  ["serif", "Serif"],
  ["mono", "Mono"],
];

/**
 * Previews the `fonts.*` settings as Configuration currently holds them,
 * saved or not, so discarding or resetting takes a preview back as well;
 * saving makes it stick.
 */
export function useFontPreview(
  client: Client,
  valueOf: (path: string) => unknown,
): void {
  const ui = valueOf("fonts.ui") as string | undefined;
  const editor = valueOf("fonts.editor") as string | undefined;
  const code = valueOf("fonts.code") as string | undefined;
  const editorSize = valueOf("fonts.editorSize") as number | undefined;
  useEffect(() => {
    const available = client.config.get<Record<string, FontEntry>>(
      "fonts.available",
      {},
    );
    applyFontStylesheet(
      fontStylesheet(
        fontSelectionFor(
          { ui, editor, code, editorSize, available },
          client.bootConfig.defaultFont,
        ),
        baseOf(document),
      ),
    );
  }, [ui, editor, code, editorSize]);
}

/**
 * A `fonts.*` setting: a font from `fonts.available`, the default, or a
 * custom CSS font-family.
 */
export function FontSelect(props: {
  client: Client;
  value: string | undefined;
  kind: "any" | "mono";
  label: string;
  disabled: boolean;
  onChange: (value: string | undefined) => void;
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
  const globalDefault = props.client.bootConfig.defaultFont;
  const defaultName =
    usableEntry(available, globalDefault ?? DEFAULT_FONT)?.name ??
    globalDefault ??
    usableEntry(available, DEFAULT_FONT)?.name;
  const groups = GROUPS.filter(
    ([kind]) => props.kind === "any" || kind === props.kind,
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
        {props.kind === "any" && (
          <option value="">
            {defaultName ? `Default (${defaultName})` : "Default"}
          </option>
        )}
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
          onInput={(e) => props.onChange(e.currentTarget.value || undefined)}
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
