import { BUILTIN_FONTS, DEFAULT_FONT } from "../lib/fonts.ts";
import { Select, type SelectProps } from "./select.tsx";

export type DefaultFontSelectProps = Omit<SelectProps, "value" | "onChange"> & {
  /** A built-in font's key, or "" for the built-in default. */
  value: string;
  onChange: (value: string) => void;
};

/**
 * The server- or app-wide default font: a page with no space has no font
 * libraries, so only the built-in fonts are offered.
 */
export function DefaultFontSelect({
  value,
  onChange,
  ...rest
}: DefaultFontSelectProps) {
  return (
    <Select
      {...rest}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value="">
        Built-in default ({BUILTIN_FONTS[DEFAULT_FONT].name})
      </option>
      {Object.entries(BUILTIN_FONTS).map(([key, font]) => (
        <option key={key} value={key}>
          {font.name}
        </option>
      ))}
    </Select>
  );
}
