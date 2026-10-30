import { Button } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { isMacLike } from "../../../plug-api/lib/shortcut.ts";
import { CONFIG_PAGE } from "../../config_management/config_page.ts";
import { openRef } from "../shared/action.ts";
import { BlockNote } from "../shared/block_ui.tsx";
import {
  SectionSidebar,
  type SidebarItem,
  useNarrow,
} from "../shared/section_sidebar.tsx";
import type { TabProps } from "../tab.ts";
import type { ConfigurationModel, Section } from "./configuration_model.ts";
import { KeyBindingsSection } from "./key_bindings_section.tsx";
import { OptionsSection } from "./options_section.tsx";

const READ_ONLY_NOTE =
  "This space is read-only: configuration and key bindings can't be changed here.";

const PLACEHOLDERS: Record<Section, string> = {
  configuration: "Filter options",
  keyBindings: "Filter commands",
};

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function useModel(model: ConfigurationModel) {
  const [, setVersion] = useState(0);
  useEffect(() => model.subscribe(() => setVersion((v) => v + 1)), [model]);
}

export function ConfigurationView({
  client,
  configuration: model,
  focusTarget,
  showing,
}: TabProps) {
  useModel(model);
  const [phrases, setPhrases] = useState<Record<Section, string>>({
    configuration: "",
    keyBindings: "",
  });
  const filterInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);

  useEffect(() => {
    const el = filterInput.current;
    return el ? focusTarget(el) : undefined;
  }, [focusTarget]);

  const { section, index, source } = model;
  const phrase = phrases[section];
  const writable = !!source?.writable;
  const canSave = model.dirty && !model.managedBlockError && writable;

  const fieldCount = Object.values(index.categoryMap).reduce(
    (n, fields) => n + fields.length,
    0,
  );
  const commandNames = Object.values(source?.commands ?? {}).filter(
    (c) => !c.hide,
  );
  const items: SidebarItem<Section>[] = [
    {
      key: "configuration",
      label: "Configuration",
      count: fieldCount,
      children: index.sortedCategoryNames.map((name) => ({
        key: name,
        label: name,
        count: index.categoryMap[name].length,
      })),
    },
    { key: "keyBindings", label: "Key bindings", count: commandNames.length },
  ];

  const scrollToCategory = (name: string) => {
    body.current
      ?.querySelector(`[data-category="${CSS.escape(name)}"]`)
      ?.scrollIntoView({ block: "start" });
  };

  const modifiedCount = Object.values(index.categoryMap)
    .flat()
    .filter((f) => model.isModified(f.path)).length;
  const reboundCount = Object.keys(model.pending.commands).length;
  const unsaved = model.unsavedCount;

  return (
    <div
      className="sb-workbench sb-wb-configuration"
      ref={root}
      onKeyDown={(e) => {
        const mod = isMacLike ? e.metaKey : e.ctrlKey;
        if (mod && e.key === "s" && canSave) {
          e.preventDefault();
          e.stopPropagation();
          void model.save();
        }
      }}
    >
      <div className="sb-wb-cfg-layout">
        <SectionSidebar
          label="Configuration sections"
          items={items}
          active={section}
          compact={narrow}
          onSelect={(s) => model.showSection(s)}
          onSelectChild={scrollToCategory}
        />
        <div className="sb-wb-cfg-main">
          <div className="sb-wb-toolbar">
            <input
              ref={filterInput}
              type="search"
              className="sb-wb-filter"
              placeholder={PLACEHOLDERS[section]}
              aria-label={PLACEHOLDERS[section]}
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              value={phrase}
              onInput={(e) => {
                const value = e.currentTarget.value;
                setPhrases((p) => ({ ...p, [section]: value }));
              }}
            />
            {canSave && (
              <>
                <Button disabled={model.saving} onClick={() => model.discard()}>
                  Discard
                </Button>
                <Button
                  variant="primary"
                  disabled={model.saving}
                  onClick={() => void model.save()}
                >
                  {model.saving ? "Saving…" : "Save and apply"}
                </Button>
              </>
            )}
          </div>
          {!writable && model.ready && <BlockNote>{READ_ONLY_NOTE}</BlockNote>}
          {model.managedBlockError && (
            <div className="sb-wb-cfg-error">{model.managedBlockError}</div>
          )}
          {model.loadError && (
            <div className="sb-wb-cfg-error">{model.loadError}</div>
          )}
          {model.saveError && (
            <div className="sb-wb-cfg-error">{model.saveError}</div>
          )}
          <div className="sb-workbench-body" ref={body}>
            {!model.ready ? (
              model.loadError ? null : (
                <BlockNote>Loading…</BlockNote>
              )
            ) : section === "configuration" ? (
              <OptionsSection client={client} model={model} phrase={phrase} />
            ) : (
              <KeyBindingsSection
                client={client}
                model={model}
                phrase={phrase}
                showing={showing}
              />
            )}
          </div>
          <div className="sb-wb-footer">
            <span>
              {section === "configuration"
                ? plural(fieldCount, "option", "options")
                : plural(commandNames.length, "command", "commands")}
            </span>
            <span>
              {section === "configuration"
                ? `${modifiedCount.toLocaleString()} modified`
                : `${reboundCount.toLocaleString()} rebound`}
            </span>
            {unsaved > 0 && (
              <span>
                {plural(unsaved, "unsaved change", "unsaved changes")}
              </span>
            )}
            <span className="sb-wb-cfg-saved-to">
              Saved to{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void openRef(client, { path: `${CONFIG_PAGE}.md` });
                }}
              >
                CONFIG
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
