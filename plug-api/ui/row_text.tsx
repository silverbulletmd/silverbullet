import type { ComponentChildren } from "preact";
import { type Description, normalizeDescription } from "./description.ts";

export function RowText({
  primary,
  description,
  renderedDescription,
}: {
  primary: ComponentChildren;
  description?: Description;
  renderedDescription?: ComponentChildren;
}) {
  if (!description || typeof description === "string") {
    return (
      <>
        {primary}
        {renderedDescription ??
          (description && (
            <span className="sb-nav-description">{description}</span>
          ))}
      </>
    );
  }
  const normalized = normalizeDescription(description);
  if (!normalized || typeof normalized === "string") return <>{primary}</>;
  const parts: ComponentChildren[] = [];
  let offset = 0;
  for (const [start, end] of normalized.highlights ?? []) {
    parts.push(normalized.text.slice(offset, start));
    parts.push(<mark key={start}>{normalized.text.slice(start, end)}</mark>);
    offset = end;
  }
  parts.push(normalized.text.slice(offset));
  return (
    <span className="sb-nav-text">
      {primary}
      <span className="sb-nav-description sb-nav-description-structured">
        {normalized.label && (
          <span className="sb-nav-description-label">{normalized.label}</span>
        )}
        <span className="sb-nav-description-text">{parts}</span>
      </span>
    </span>
  );
}
