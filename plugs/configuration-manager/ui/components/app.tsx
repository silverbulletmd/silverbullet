import { useCallback, useState } from "preact/hooks";
import { X } from "preact-feather";
import * as editor from "../../../../plug-api/syscalls/editor.ts";
import { useCfg } from "../cfg_context.tsx";
import { EditorsContext } from "../editors_context.tsx";
import { useConfigEditor } from "../use_config_editor.ts";
import { useShortcutEditor } from "../use_shortcut_editor.ts";
import { useLibrariesEditor } from "../use_libraries_editor.ts";
import { useSave } from "../use_save.ts";
import { useGlobalEscape } from "../use_global_escape.ts";
import { ConfigurationTab } from "./configuration_tab.tsx";
import { ShortcutsTab } from "./shortcuts_tab.tsx";
import { LibrariesTab } from "./libraries_tab.tsx";
import { cls } from "./chord_display.tsx";
import type { TabId } from "../types.ts";

const TABS: { id: TabId; label: string }[] = [
  { id: "configuration", label: "Configuration" },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
  { id: "libraries", label: "Libraries" },
];

async function close() {
  await editor.hidePanel("modal");
  await editor.focus();
}

async function openConfigPage() {
  await editor.navigate("CONFIG");
  await editor.hidePanel("modal");
  await editor.focus();
}

function Header({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  return (
    <div id="cfg-header">
      <h1>Configuration</h1>
      <button id="cfg-close" title="Close" onClick={close}>
        <X size={18} />
      </button>
      <div id="cfg-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            class={cls({ "cfg-tab": true, active: tab === t.id })}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SaveFooter({
  saving,
  save,
  error,
  dismissError,
}: {
  saving: boolean;
  save: () => void;
  error?: string;
  dismissError: () => void;
}) {
  return (
    <>
      {error && (
        <div class="lib-banner lib-error" id="cfg-save-error">
          <span>{error}</span>
          <button
            type="button"
            class="lib-banner-dismiss"
            title="Dismiss"
            onClick={dismissError}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div id="cfg-footer">
        <a
          href="#"
          id="cfg-edit-config"
          onClick={(e) => {
            e.preventDefault();
            void openConfigPage();
          }}
        >
          Changes will be reflected in CONFIG.md
        </a>
        <button
          class="cfg-btn"
          id="cfg-cancel"
          disabled={saving}
          onClick={close}
        >
          Cancel
        </button>
        <button
          class="cfg-btn cfg-btn-primary"
          id="cfg-save"
          disabled={saving}
          onClick={save}
        >
          {saving ? (
            <>
              <span class="cfg-spinner"></span>Saving…
            </>
          ) : (
            <>Save &amp; Apply</>
          )}
        </button>
      </div>
    </>
  );
}

function LibrariesFooter() {
  return (
    <div id="cfg-footer">
      <span id="cfg-edit-config" class="lib-footer-note">
        Library changes are applied immediately.
      </span>
      <button class="cfg-btn" onClick={close}>
        Close
      </button>
    </div>
  );
}

export function App() {
  const { cfg } = useCfg();
  const config = useConfigEditor();
  const shortcuts = useShortcutEditor();
  const libraries = useLibrariesEditor(cfg.libraries);
  const { save, saving, error: saveError, dismissError } = useSave(
    config,
    shortcuts,
  );
  const [tab, setTab] = useState<TabId>(cfg.initialTab);

  useGlobalEscape(useCallback(() => close(), []));

  return (
    <EditorsContext.Provider value={{ config, shortcuts, libraries }}>
      <Header tab={tab} setTab={setTab} />
      <div id="cfg-content">
        {tab === "configuration" ? (
          <ConfigurationTab />
        ) : tab === "shortcuts" ? (
          <ShortcutsTab />
        ) : (
          <LibrariesTab />
        )}
      </div>
      {tab === "libraries" ? (
        <LibrariesFooter />
      ) : (
        <SaveFooter
          saving={saving}
          save={save}
          error={saveError}
          dismissError={dismissError}
        />
      )}
    </EditorsContext.Provider>
  );
}
