import { Button } from "@silverbulletmd/silverbullet/ui";
import type { Client } from "../../client.ts";
import { isNarrowScreen } from "../../lib/mobile.ts";
import { viewTitle } from "../../navigator/navigator.ts";
import { resolveMeta } from "../../navigator/registry.ts";
import type { ConfigurationModel } from "./configuration_model.ts";
import { layoutSummary, saveCurrentLayout } from "./layout.ts";

/** The `layout` control: a summary of the default and a button to capture it. */
export function LayoutControl(props: {
  client: Client;
  model: ConfigurationModel;
  path: string;
  disabled: boolean;
}) {
  const { model, path, disabled } = props;
  const narrow = isNarrowScreen();
  const summary = layoutSummary(
    model.valueOf(path),
    (name) => resolveMeta(name)?.dock,
    viewTitle,
  );
  const modified = model.isModified(path);
  const setElsewhere = !modified && summary.some((s) => s.text !== "—");
  return (
    <div className="sb-wb-cfg-default-layout">
      <dl>
        {summary.map((s) => (
          <div key={s.slot}>
            <dt>{s.label}:</dt>
            <dd>{s.text}</dd>
          </div>
        ))}
      </dl>
      {setElsewhere && (
        <span className="sb-wb-muted">
          Set in your own block of Library/Config
        </span>
      )}
      <span className="sb-wb-cfg-default-layout-actions">
        <Button
          disabled={disabled || narrow}
          // A failed save shows in the tab's own error banner
          onClick={() => void saveCurrentLayout(model).catch(() => {})}
        >
          Use current layout
        </Button>
        {modified && (
          <button
            type="button"
            className="sb-wb-cfg-changed"
            disabled={disabled}
            onClick={() => model.resetField(path)}
          >
            Clear
          </button>
        )}
      </span>
      {narrow && (
        <span className="sb-wb-muted">
          Widen the window to capture a layout
        </span>
      )}
    </div>
  );
}
