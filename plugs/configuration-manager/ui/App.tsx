import { useCallback, useState } from "preact/hooks";
import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { useCfg } from "./CfgContext.tsx";
import { EditorsContext } from "./EditorsContext.tsx";
import { useConfigEditor } from "./useConfigEditor.ts";
import { useShortcutEditor } from "./useShortcutEditor.ts";
import { useSave } from "./useSave.ts";
import { useGlobalEscape } from "./useGlobalEscape.ts";
import { ConfigurationTab } from "./ConfigurationTab.tsx";
import { ShortcutsTab } from "./ShortcutsTab.tsx";
import { cls } from "./chord_display.tsx";
import type { TabId } from "./types.ts";

const TABS: { id: TabId; label: string }[] = [
  { id: "configuration", label: "Configuration" },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
];

function close() {
  void editor.hidePanel("modal");
}

async function openConfigPage() {
  // Navigate first, then hide. hidePanel tears down the iframe worker and
  // cancels any in-flight syscalls, so an awaited navigate that follows it
  // never reaches the main thread.
  await editor.navigate("CONFIG");
  await editor.hidePanel("modal");
}

function Header(
  { tab, setTab }: { tab: TabId; setTab: (t: TabId) => void },
) {
  return (
    <div id="cfg-header">
      <h1>Configuration</h1>
      <button id="cfg-close" title="Close" onClick={close}>×</button>
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

function Footer(
  { saving, save }: { saving: boolean; save: () => void },
) {
  return (
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
        {saving
          ? (
            <>
              <span class="cfg-spinner"></span>Saving…
            </>
          )
          : <>Save &amp; Apply</>}
      </button>
    </div>
  );
}

export function App() {
  const { cfg } = useCfg();
  const config = useConfigEditor();
  const shortcuts = useShortcutEditor();
  const { save, saving } = useSave(config, shortcuts);
  const [tab, setTab] = useState<TabId>(cfg.initialTab);

  useGlobalEscape(useCallback(() => close(), []));

  return (
    <EditorsContext.Provider value={{ config, shortcuts }}>
      <Header tab={tab} setTab={setTab} />
      <div id="cfg-content">
        {tab === "configuration" ? <ConfigurationTab /> : <ShortcutsTab />}
      </div>
      <Footer saving={saving} save={save} />
    </EditorsContext.Provider>
  );
}
