import type { Decoration } from "./tree_types.ts";

export function Chip({ decoration }: { decoration: Decoration }) {
  return (
    <span
      className={"sb-nav-chip " + (decoration.cssClass ?? "")}
      title={decoration.title}
    >
      {decoration.text ?? decoration.icon}
    </span>
  );
}

/** Chips that don't fit wrap onto later lines, which `.sb-nav-trailing`
 * clips away in CSS: measuring them in JS forced a layout per row, which
 * made a long list slow to open. */
export function TrailingChips({ decorations }: { decorations: Decoration[] }) {
  return (
    <span className="sb-nav-trailing">
      {decorations.map((decoration, index) => (
        <Chip key={index} decoration={decoration} />
      ))}
    </span>
  );
}
