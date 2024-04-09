import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { useRef, useState } from "preact/hooks";
import { MiniEditor } from "./mini_editor.tsx";
import { ComponentChildren, Ref } from "preact";

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
    <AlwaysShownModal>
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
        <div className="sb-prompt-buttons">
          <Button
            primary={true}
            onActivate={() => {
              callback(text);
            }}
          >
            Ok
          </Button>
          <Button
            onActivate={() => {
              callback();
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </AlwaysShownModal>
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
    <AlwaysShownModal
      onCancel={() => {
        callback(false);
      }}
    >
      <div className="sb-prompt">
        <label>{message}</label>
        <div className="sb-prompt-buttons">
          <Button
            ref={okButtonRef}
            primary={true}
            onActivate={() => {
              callback(true);
            }}
          >
            Ok
          </Button>
          <Button
            onActivate={() => {
              callback(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </AlwaysShownModal>
  );

  return returnEl;
}

export function Button({
  children,
  primary,
  onActivate,
  ref,
}: {
  children: ComponentChildren;
  primary?: boolean;
  onActivate: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      className={primary ? "sb-button-primary" : "sb-button"}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {children}
    </button>
  );
}

export function AlwaysShownModal({
  children,
  onCancel,
}: {
  children: ComponentChildren;
  onCancel?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  setTimeout(() => {
    dialogRef.current?.showModal();
    dialogRef.current?.addEventListener("cancel", (e) => {
      e.preventDefault();
      onCancel?.();
    });
  });
  return (
    <dialog
      className="sb-modal-box"
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
