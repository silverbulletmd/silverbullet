import {
  CompletionContext,
  CompletionResult,
  useEffect,
  useRef,
} from "../deps.ts";
import type { ComponentChildren, FunctionalComponent } from "../deps.ts";
import { Notification } from "../types.ts";
import { FeatherProps } from "https://esm.sh/v99/preact-feather@4.2.1/dist/types";
import { MiniEditor } from "./mini_editor.tsx";

export type ActionButton = {
  icon: FunctionalComponent<FeatherProps>;
  description: string;
  callback: () => void;
};

export function TopBar({
  pageName,
  unsavedChanges,
  synced,
  isLoading,
  notifications,
  onRename,
  actionButtons,
  darkMode,
  vimMode,
  completer,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  synced: boolean;
  isLoading: boolean;
  notifications: Notification[];
  darkMode: boolean;
  vimMode: boolean;
  onRename: (newName?: string) => Promise<void>;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Another one of my less proud moments:
  // Somehow I cannot seem to proerply limit the width of the page name, so I'm doing
  // it this way. If you have a better way to do this, please let me know!
  useEffect(() => {
    function resizeHandler() {
      const editorWidth = parseInt(
        getComputedStyle(document.getElementById("sb-root")!).getPropertyValue(
          "--editor-width",
        ),
      );
      const currentPageElement = document.getElementById("sb-current-page");
      if (currentPageElement) {
        // Temporarily make it very narrow to give the parent space
        currentPageElement.style.width = "10px";
        const innerDiv = currentPageElement.parentElement!.parentElement!;

        // Then calculate a new width
        currentPageElement.style.width = `${
          Math.min(editorWidth - 150, innerDiv.clientWidth - 150)
        }px`;
      }
    }
    globalThis.addEventListener("resize", resizeHandler);

    // Stop listening on unmount
    return () => {
      globalThis.removeEventListener("resize", resizeHandler);
    };
  }, []);

  return (
    <div id="sb-top" className={synced ? undefined : "sb-sync-error"}>
      {lhs}
      <div className="main">
        <div className="inner">
          <div className="wrapper">
            <span
              id="sb-current-page"
              className={isLoading
                ? "sb-loading"
                : unsavedChanges
                ? "sb-unsaved"
                : "sb-saved"}
            >
              <MiniEditor
                text={pageName ?? ""}
                vimMode={vimMode}
                darkMode={darkMode}
                onBlur={(newName) => {
                  if (newName !== pageName) {
                    return onRename(newName);
                  } else {
                    return onRename();
                  }
                }}
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
