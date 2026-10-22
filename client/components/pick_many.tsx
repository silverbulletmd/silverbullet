import { Button } from "@silverbulletmd/silverbullet/ui";
import { useState } from "preact/hooks";
import type { PickManyOptions } from "../../plug-api/syscalls/editor.ts";
import { AlwaysShownModal } from "./basic_modals.tsx";

export function PickManyModal({
  options,
  callback,
}: {
  options: PickManyOptions;
  callback: (ids: string[] | undefined) => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  return (
    <AlwaysShownModal onCancel={() => callback(undefined)}>
      <div className="sb-prompt sb-pick-many">
        <label>{options.title}</label>
        {options.message && <div>{options.message}</div>}
        <div className="sb-pick-many-list">
          {options.items.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={ticked.has(item.id)}
                onChange={(e) => {
                  const next = new Set(ticked);
                  if (e.currentTarget.checked) {
                    next.add(item.id);
                  } else {
                    next.delete(item.id);
                  }
                  setTicked(next);
                }}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
        <div className="sb-prompt-buttons">
          <Button
            shortcut="esc"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback(undefined);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback(
                options.items.map((i) => i.id).filter((id) => ticked.has(id)),
              );
            }}
          >
            {options.confirmLabel ?? "OK"}
          </Button>
        </div>
      </div>
    </AlwaysShownModal>
  );
}
