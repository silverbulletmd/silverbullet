import { useCallback, useMemo, useState } from "preact/hooks";
import { useCfg } from "./CfgContext.tsx";
import { useShortcuts } from "./EditorsContext.tsx";
import { ChordChips, cls } from "./chord_display.tsx";
import { RecordingChord } from "./RecordingChord.tsx";

type RecordingTarget = { name: string; slot: number } | null;

function ShortcutCell(
  { name, binding, slot, onStart }: {
    name: string;
    binding: string;
    slot: number;
    onStart: () => void;
  },
) {
  const shortcuts = useShortcuts();
  return (
    <>
      <span class="cfg-chord" onClick={onStart}>
        <ChordChips binding={binding} />
      </span>
      {binding && (
        <button
          class="cfg-slot-delete"
          title="Remove this binding"
          onClick={(e) => {
            e.stopPropagation();
            shortcuts.deleteSlot(name, slot);
          }}
        >
          ×
        </button>
      )}
    </>
  );
}

function ShortcutRow(
  { name, recording, setRecording }: {
    name: string;
    recording: RecordingTarget;
    setRecording: (r: RecordingTarget) => void;
  },
) {
  const shortcuts = useShortcuts();
  const bindings = shortcuts.resolvedBindings(name);
  const isModified = shortcuts.isModified(name);
  const rec = recording && recording.name === name ? recording : null;
  const displaySlots = bindings.length > 0 ? bindings : [""];
  const showingRecordAtEnd = rec && rec.slot >= displaySlots.length;

  const onCancel = useCallback(() => setRecording(null), [setRecording]);

  // Commit a recorded chord. Return the conflict (if any) so RecordingChord
  // can show it; on success we unmount the recorder.
  const commitAt = useCallback(
    (slot: number) => (tokens: string[]) => {
      const conflict = shortcuts.commit(name, slot, tokens);
      if (!conflict) setRecording(null);
      return conflict;
    },
    [shortcuts, name, setRecording],
  );

  const conflictAt = useCallback(
    (slot: number) => (tokens: string[]) =>
      shortcuts.conflictCheck(tokens, { name, slot }),
    [shortcuts, name],
  );

  return (
    <tr class={cls({ modified: isModified })}>
      <td>{name}</td>
      <td>
        <div class="cfg-chord-list">
          {displaySlots.map((binding, i) => (
            <div class="cfg-chord-slot" key={i}>
              {rec?.slot === i
                ? (
                  <RecordingChord
                    onCommit={commitAt(i)}
                    onCancel={onCancel}
                    conflictCheck={conflictAt(i)}
                  />
                )
                : (
                  <ShortcutCell
                    name={name}
                    binding={binding}
                    slot={i}
                    onStart={() => setRecording({ name, slot: i })}
                  />
                )}
            </div>
          ))}
          {showingRecordAtEnd && (
            <div class="cfg-chord-slot">
              <RecordingChord
                onCommit={commitAt(rec.slot)}
                onCancel={onCancel}
                conflictCheck={conflictAt(rec.slot)}
              />
            </div>
          )}
          {bindings.length > 0 && (
            <button
              class="cfg-add-alternate"
              title="Add an alternate key binding for this command"
              disabled={!!rec}
              onClick={() =>
                setRecording({ name, slot: shortcuts.alternateSlot(name) })}
            >
              +
            </button>
          )}
        </div>
      </td>
      <td>
        <button
          class="cfg-reset-btn"
          disabled={!isModified}
          onClick={() => shortcuts.reset(name)}
        >
          Reset
        </button>
      </td>
    </tr>
  );
}

export function ShortcutsTab() {
  const { cfg } = useCfg();
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState<RecordingTarget>(null);

  const sortedCommandNames = useMemo(
    () =>
      Object.keys(cfg.commands)
        .filter((name) => !cfg.commands[name].hide)
        .sort(),
    [cfg.commands],
  );

  const query = search.toLowerCase();
  const visible = sortedCommandNames.filter(
    (n) => !query || n.toLowerCase().includes(query),
  );

  return (
    <>
      <input
        type="text"
        id="cfg-shortcuts-search"
        placeholder="Search commands..."
        value={search}
        onInput={(e) =>
          setSearch((e.currentTarget as HTMLInputElement).value)}
      />
      <table id="cfg-shortcuts-table">
        <thead>
          <tr>
            <th>Command</th>
            <th>{cfg.isMac ? "Shortcut" : "Key Binding"}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((n) => (
            <ShortcutRow
              key={n}
              name={n}
              recording={recording}
              setRecording={setRecording}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}
