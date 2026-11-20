import { IconPicker } from "../../plug-api/ui/icon_picker.tsx";
import { AlwaysShownModal } from "./basic_modals.tsx";
import { CloseIcon } from "./chrome_icons.tsx";

/** `editor.pickIcon`'s dialog: resolves a name, null for "no icon", or
 * undefined when cancelled. Dressed as the page picker (`sb-nav-root-modal`):
 * search glyph, short label, close button and help strip. */
export function IconPickerModal({
  title,
  initial,
  onPick,
}: {
  title?: string;
  initial?: string;
  onPick: (name: string | null | undefined) => void;
}) {
  return (
    <AlwaysShownModal onCancel={() => onPick(undefined)}>
      <div className="sb-nav-root sb-nav-root-modal sb-icon-picker-modal">
        <IconPicker
          title={title ?? "Icon"}
          value={initial ?? null}
          autoFocus
          onPick={onPick}
          onCancel={() => onPick(undefined)}
          headerEnd={
            <button
              type="button"
              className="sb-nav-close"
              title="Close"
              aria-label="Close"
              onClick={() => onPick(undefined)}
            >
              <CloseIcon />
            </button>
          }
        />
      </div>
    </AlwaysShownModal>
  );
}
