import {
  CompletionContext,
  CompletionResult,
  useRef,
  useState,
} from "../deps.ts";
import { ComponentChildren } from "../deps.ts";
import { Notification } from "../types.ts";
import { FunctionalComponent } from "https://esm.sh/v99/preact@10.11.1/src/index";
import { FeatherProps } from "https://esm.sh/v99/preact-feather@4.2.1/dist/types";
import { MiniEditor } from "./mini_editor.tsx";

function prettyName(s: string | undefined): string {
  if (!s) {
    return "";
  }
  return s.replaceAll("/", " / ");
}

export type ActionButton = {
  icon: FunctionalComponent<FeatherProps>;
  description: string;
  callback: () => void;
};

export function TopBar({
  pageName,
  unsavedChanges,
  isLoading,
  notifications,
  onRename,
  actionButtons,
  vimMode,
  completer,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  isLoading: boolean;
  notifications: Notification[];
  vimMode: boolean;
  onRename: (newName?: string) => void;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
}) {
  // const [theme, setTheme] = useState<string>(localStorage.theme ?? "light");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div id="sb-top">
      {lhs}
      <div className="main">
        <div className="inner">
          <div className="wrapper">
            <span
              className={`sb-current-page ${
                isLoading
                  ? "sb-loading"
                  : unsavedChanges
                  ? "sb-unsaved"
                  : "sb-saved"
              }`}
            >
              <MiniEditor
                text={pageName ?? ""}
                vimMode={vimMode}
                onBlur={() => {
                  onRename();
                }}
                onKeyUp={(_view, event) => {
                  // When moving cursor down, cancel and move back to editor
                  if (event.key === "ArrowDown") {
                    const parent =
                      (event.target as any).parentElement.parentElement;
                    // Unless we have autocomplete open
                    if (
                      parent.getElementsByClassName("cm-tooltip-autocomplete")
                        .length === 0
                    ) {
                      onRename();
                      return true;
                    }
                  }
                  return false;
                }}
                resetOnBlur={true}
                completer={completer}
                onEnter={(newName) => {
                  onRename(newName);
                }}
              />
            </span>
            {notifications.length > 0 && (
              <div className="sb-notifications">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`sb-notification-${notification.type}`}
                  >
                    {notification.message}
                  </div>
                ))}
              </div>
            )}
            <div className="sb-actions">
              {actionButtons.map((actionButton) => (
                <button
                  onClick={(e) => {
                    actionButton.callback();
                    e.stopPropagation();
                  }}
                  title={actionButton.description}
                >
                  <actionButton.icon size={18} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
