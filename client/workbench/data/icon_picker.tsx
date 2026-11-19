import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { IconPicker as IconGrid } from "../../../plug-api/ui/icon_picker.tsx";
import { placePopupMenu } from "../../components/menu_placement.ts";
import { TagIcon } from "./tag_list_view.tsx";

/** A tag's icon, opening the shared icon picker to change it. */
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Fixed, so the Workbench panel's overflow can't clip it, and flipped
  // above the button when it would run off the bottom of the window
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!open || !button || !popover) return;
    const { top, left } = placePopupMenu(
      button.getBoundingClientRect(),
      popover.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      "start",
    );
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }, [open]);
  return (
    <span className="sb-wbd-iconpick">
      <button
        type="button"
        className="sb-wbd-iconbutton"
        aria-label="Change icon"
        title={disabled ? icon : "Change icon"}
        ref={buttonRef}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <TagIcon icon={icon} />
      </button>
      {open ? (
        <div
          className="sb-wbd-icongrid"
          role="dialog"
          aria-label="Icons"
          ref={popoverRef}
        >
          <IconGrid
            value={icon}
            autoFocus
            onCancel={() => setOpen(false)}
            onPick={(name) => {
              onPick(name);
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </span>
  );
}
