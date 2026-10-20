import { Button } from "@silverbulletmd/silverbullet/ui";
import type { ChooseVersionOptions } from "../../plug-api/syscalls/editor.ts";
import { lineDiff } from "../lib/line_diff.ts";
import { AlwaysShownModal } from "./basic_modals.tsx";

export function ChooseVersionModal({
  options,
  callback,
}: {
  options: ChooseVersionOptions;
  callback: (choice: string | undefined) => void;
}) {
  const diff = lineDiff(options.mine, options.theirs);
  return (
    <AlwaysShownModal onCancel={() => callback(undefined)}>
      <div className="sb-prompt sb-choose-version">
        <label>{options.title}</label>
        {options.message && <div>{options.message}</div>}
        <div className="sb-choose-version-legend">
          <span className="sb-revision-diff-del">- this device</span>{" "}
          <span className="sb-revision-diff-add">+ the other side</span>
        </div>
        <pre className="sb-revision-preview-body sb-choose-version-diff">
          {diff.map((line, i) => (
            <div key={i} className={line.cssClass}>
              {/* Its own column, so it can't merge with a list item's "- " */}
              <span className="sb-choose-version-sign">{line.text[0]}</span>
              {line.text.slice(1) || " "}
            </div>
          ))}
        </pre>
        <div className="sb-prompt-buttons">
          {options.choices.map((choice) => (
            <Button
              key={choice.id}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                callback(choice.id);
              }}
            >
              {choice.label}
            </Button>
          ))}
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
        </div>
      </div>
    </AlwaysShownModal>
  );
}
