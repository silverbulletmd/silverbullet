import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { useRef, useState } from "preact/hooks";
import { MiniEditor } from "./mini_editor.tsx";

export function Prompt({
  message,
  defaultValue,
  vimMode,
  darkMode,
  completer,
  callback,
}: {
  message: string;
  defaultValue?: string;
  vimMode: boolean;
  darkMode: boolean;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  callback: (value?: string) => void;
}) {
  const [text, setText] = useState(defaultValue || "");
  const returnEl = (
    <div className="sb-modal-box">
      <div className="sb-prompt">
        <label>{message}</label>
        <MiniEditor
          text={defaultValue || ""}
          vimMode={vimMode}
          vimStartInInsertMode={true}
          focus={true}
          darkMode={darkMode}
          completer={completer}
          onEnter={(text) => {
            callback(text);
            return true;
          }}
          onEscape={() => {
            callback();
          }}
          onChange={(text) => {
            setText(text);
          }}
        />
        <button
          onClick={() => {
            callback(text);
          }}
        >
          Ok
        </button>
        <button
          onClick={() => {
            callback();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return returnEl;
}

export function Confirm({
  message,
  callback,
}: {
  message: string;
  callback: (value: boolean) => void;
}) {
  const okButtonRef = useRef<HTMLButtonElement>(null);
  setTimeout(() => {
    okButtonRef.current?.focus();
  });
  const returnEl = (
    <div className="sb-modal-wrapper">
      <div className="sb-modal-box">
        <div
          className="sb-prompt"
          onKeyDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            switch (e.key) {
              case "Enter":
                callback(true);
                break;
              case "Escape":
                callback(false);
                break;
            }
          }}
        >
          <label>{message}</label>
          <div>
            <button
              ref={okButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                callback(true);
              }}
            >
              Ok
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                callback(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return returnEl;
}
