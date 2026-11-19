import { IconPicker } from "../../plug-api/ui/icon_picker.tsx";
import { AlwaysShownModal } from "./basic_modals.tsx";

/** `editor.pickIcon`'s dialog: resolves a name, null for "no icon", or undefined when cancelled. */
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
      <IconPicker
        title={title ?? "Icon"}
        value={initial ?? null}
        autoFocus
        onPick={onPick}
        onCancel={() => onPick(undefined)}
      />
    </AlwaysShownModal>
  );
}
