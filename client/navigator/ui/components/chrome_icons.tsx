import type { JSX } from "preact";

export const CHROME_ICON_PROPS = {
  width: "16",
  height: "16",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5",
  "aria-hidden": "true",
} as const;

export function CopyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...CHROME_ICON_PROPS}>
      <rect x="6" y="6" width="8.5" height="8.5" rx="1.5" />
      <path d="M3.5 10H3A1.5 1.5 0 0 1 1.5 8.5V3A1.5 1.5 0 0 1 3 1.5h5.5A1.5 1.5 0 0 1 10 3v.5" />
    </svg>
  );
}

export function EditIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      {...CHROME_ICON_PROPS}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...CHROME_ICON_PROPS} stroke-linecap="round">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}
