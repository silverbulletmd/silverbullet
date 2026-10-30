import { useEffect, useRef, useState } from "preact/hooks";
import type { Client } from "../../client.ts";
import type { Action } from "../shared/action.ts";
import { ActionMenu } from "../shared/action_menu.tsx";
import { BlockNote } from "../shared/block_ui.tsx";
import {
  ChordDisplay,
  chordNotice,
  RecordingPreview,
  useChordRecorder,
} from "./chord.tsx";
import type { ConfigurationModel } from "./configuration_model.ts";

type Recording = {
  name: string;
  slot: number;
  tokens: string[];
  invalidFirstKey: string | null;
};

type RowDeps = { client: Client; model: ConfigurationModel; name: string };

export function KeyBindingsSection(props: {
  client: Client;
  model: ConfigurationModel;
  phrase: string;
  showing: boolean;
}) {
  const { client, model, showing } = props;
  const [recording, setRecording] = useState<Recording | null>(null);
  const isMac = model.source?.isMac ?? false;
  const container = useRef<HTMLDivElement>(null);
  const recordingRow = useRef<HTMLDivElement>(null);
  const lastRecorded = useRef<Recording | null>(null);

  useEffect(() => {
    if (!showing) setRecording(null);
  }, [showing]);

  // Recording replaced the focused chord button: give focus back to it (or
  // the row's first one, for an alternate that wasn't kept)
  useEffect(() => {
    if (recording) {
      lastRecorded.current = recording;
      return;
    }
    const last = lastRecorded.current;
    lastRecorded.current = null;
    if (!last || !showing) return;
    const buttons = container.current?.querySelectorAll<HTMLElement>(
      `[data-binding="${CSS.escape(last.name)}"] .sb-wb-cfg-chord`,
    );
    (buttons?.[last.slot] ?? buttons?.[0])?.focus();
  }, [recording, showing]);

  useChordRecorder(recording !== null, isMac, recordingRow, {
    key: (notation, hasModifier) =>
      setRecording((r) => {
        if (!r) return r;
        if (r.tokens.length === 0 && !hasModifier) {
          return { ...r, invalidFirstKey: notation };
        }
        return { ...r, tokens: [...r.tokens, notation], invalidFirstKey: null };
      }),
    undo: () =>
      setRecording((r) =>
        r ? { ...r, tokens: r.tokens.slice(0, -1), invalidFirstKey: null } : r,
      ),
    commit: () => {
      if (!recording || recording.tokens.length === 0) return;
      // A refused chord keeps recording, its conflict showing under the row
      if (!model.commit(recording.name, recording.slot, recording.tokens)) {
        setRecording(null);
      }
    },
    cancel: () => setRecording(null),
    leave: () => {
      lastRecorded.current = null;
      setRecording(null);
    },
  });

  const q = props.phrase.toLowerCase().trim();
  const names = Object.values(model.source?.commands ?? {})
    .filter((c) => !c.hide && (!q || c.name.toLowerCase().includes(q)))
    .map((c) => c.name)
    .sort();
  if (names.length === 0) {
    return <BlockNote>No commands match.</BlockNote>;
  }
  const writable = !!model.source?.writable;
  return (
    <div className="sb-wb-cfg-bindings" ref={container}>
      {names.map((name) => (
        <BindingRow
          key={name}
          rowRef={recording?.name === name ? recordingRow : undefined}
          client={client}
          model={model}
          name={name}
          writable={writable}
          recording={recording?.name === name ? recording : null}
          record={(slot) =>
            setRecording({ name, slot, tokens: [], invalidFirstKey: null })
          }
        />
      ))}
    </div>
  );
}

function BindingRow(props: {
  client: Client;
  model: ConfigurationModel;
  name: string;
  writable: boolean;
  recording: Recording | null;
  record: (slot: number) => void;
  rowRef?: { current: HTMLDivElement | null };
}) {
  const { client, model, name, writable, recording, record, rowRef } = props;
  const bindings = model.resolvedBindings(name);
  const modified = model.isBindingModified(name);
  const slots = bindings.length > 0 ? bindings : [""];
  const notice = recording
    ? chordNotice(
        model.conflictCheck(recording.tokens, {
          name,
          slot: recording.slot,
        }),
        recording.invalidFirstKey,
      )
    : null;

  const actions: Action<RowDeps>[] = [
    ...(writable && modified
      ? [
          {
            label: "Reset",
            icon: "revert" as const,
            run: async ({ model, name }: RowDeps) => model.resetBinding(name),
          },
        ]
      : []),
    ...(writable
      ? bindings.map((binding, slot) => ({
          label:
            bindings.length > 1
              ? `Remove binding ${binding}`
              : "Remove binding",
          icon: "remove" as const,
          run: async ({ model, name }: RowDeps) => model.deleteSlot(name, slot),
        }))
      : []),
    {
      label: "Run command",
      icon: "open",
      run: async ({ client, name }) => {
        await client.runCommandByName(name);
      },
    },
  ];

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={name}
      data-binding={name}
      className="sb-wb-cfg-binding"
      data-modified={modified || undefined}
    >
      <div className="sb-wb-cfg-row">
        <span
          className={
            modified ? "sb-wb-cfg-dot sb-wb-cfg-modified" : "sb-wb-cfg-dot"
          }
        />
        <div className="sb-wb-cfg-label">{name}</div>
        <div className="sb-wb-cfg-chords">
          {slots.map((binding, slot) =>
            recording?.slot === slot ? (
              <RecordingPreview key={slot} tokens={recording.tokens} />
            ) : (
              <button
                key={slot}
                type="button"
                className="sb-wb-cfg-chord"
                disabled={!writable || recording !== null}
                aria-label={`Record a new binding for ${name}`}
                title="Click, then press the new keys"
                onClick={() => record(slot)}
              >
                <ChordDisplay binding={binding} />
              </button>
            ),
          )}
          {recording && recording.slot >= slots.length && (
            <RecordingPreview tokens={recording.tokens} />
          )}
          {writable && bindings.length > 0 && !recording && (
            <button
              type="button"
              className="sb-wb-cfg-add"
              aria-label={`Record an alternate binding for ${name}`}
              title="Add an alternate binding"
              onClick={() => record(model.alternateSlot(name))}
            >
              +
            </button>
          )}
        </div>
        <ActionMenu actions={actions} deps={{ client, model, name }} />
      </div>
      {recording && (
        <div
          className={`sb-wb-cfg-notice sb-wb-cfg-notice-${notice?.severity ?? "hint"}`}
        >
          {notice?.message ??
            "Enter to save the binding, Esc to cancel, ⌫ to undo a key."}
        </div>
      )}
    </div>
  );
}
