import { useEffect, useRef, useState } from "preact/hooks";
import { MiniEditor } from "./mini_editor.tsx";
import type { ComponentChildren, Ref } from "preact";

export function Prompt({
  message,
  defaultValue,
  darkMode,
  callback,
}: {
  message: string;
  defaultValue?: string;
  darkMode: boolean | undefined;
  callback: (value?: string) => void;
}) {
  const [text, setText] = useState(defaultValue || "");
  const returnEl = (
    <AlwaysShownModal
      onCancel={() => {
        callback();
      }}
    >
      <div className="sb-prompt">
        <label>{message}</label>
        <MiniEditor
          text={defaultValue || ""}
          focus={true}
          darkMode={darkMode}
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
          editable={true}
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
            buttonRef={okButtonRef}
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
  buttonRef,
}: {
  children: ComponentChildren;
  primary?: boolean;
  onActivate: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.style.opacity = "0";
      dialog.showModal();

      // Workaround for Safari layout bug: CodeMirror's flex sizing inside
      // <dialog> creates a circular height dependency on first render.
      // Watch for the .cm-editor to appear, then toggle a layout property
      // to force Safari to recalculate correctly. Dialog stays hidden
      // (opacity 0) until the fix has been applied to avoid visible reflow.
      const fixSafariLayout = () => {
        // Wait for Safari to paint the (wrong) layout, then force reflow
        requestAnimationFrame(() => {
          setTimeout(() => {
            dialog.style.display = "flex";
            void dialog.offsetHeight;
            dialog.style.display = "";
            dialog.style.opacity = "";
          });
        });
      };

      if (dialog.querySelector(".cm-editor")) {
        fixSafariLayout();
      } else {
        const observer = new MutationObserver(() => {
          if (dialog.querySelector(".cm-editor")) {
            observer.disconnect();
            fixSafariLayout();
          }
        });
        observer.observe(dialog, { childList: true, subtree: true });
        // Fallback: reveal dialog even if no .cm-editor appears (e.g.
        // Confirm dialogs that don't use CodeMirror)
        setTimeout(() => {
          observer.disconnect();
          dialog.style.opacity = "";
        }, 500);
      }
    }
  }, []);

  return (
    <dialog
      className="sb-modal-box"
      onCancel={(e: Event) => {
        e.preventDefault();
        onCancel?.();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
