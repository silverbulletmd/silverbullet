import { useMemo, useState } from "preact/hooks";
import { featherIconNames } from "../../lib/feather_icons.ts";
import { TagIcon } from "./tag_list_view.tsx";

const SHOWN = 120;

/** A tag's icon, and a searchable grid of Feather icons to change it. */
export function IconPicker({
  icon,
  disabled,
  onPick,
}: {
  icon: string;
  disabled: boolean;
  /** null for no icon */
  onPick: (name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const all = useMemo(() => featherIconNames(), []);
  const p = phrase.trim().toLowerCase();
  const shown = (p ? all.filter((n) => n.includes(p)) : all).slice(0, SHOWN);
  return (
    <span className="sb-wbd-iconpick">
      <button
        type="button"
        className="sb-wbd-iconbutton"
        aria-label="Change icon"
        title={disabled ? icon : "Change icon"}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <TagIcon icon={icon} />
      </button>
      {open ? (
        <div className="sb-wbd-icongrid" role="dialog" aria-label="Icons">
          <input
            type="search"
            className="sb-wb-filter"
            placeholder="Search icons"
            aria-label="Search icons"
            value={phrase}
            ref={(el) => el?.focus()}
            onInput={(e) => setPhrase(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="sb-wbd-noicon"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
          >
            No icon
          </button>
          <div className="sb-wbd-icons">
            {shown.map((name) => (
              <button
                key={name}
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={name === icon}
                onClick={() => {
                  onPick(name);
                  setOpen(false);
                }}
              >
                <TagIcon icon={name} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </span>
  );
}
