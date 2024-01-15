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
  class?: string;
  callback: () => void;
  href?: string;
};

export function TopBar({
  pageName,
  unsavedChanges,
  syncFailures,
  isLoading,
  notifications,
  onRename,
  actionButtons,
  darkMode,
  vimMode,
  progressPerc,
  completer,
  lhs,
  onClick,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  syncFailures: number;
  isLoading: boolean;
  notifications: Notification[];
  darkMode: boolean;
  vimMode: boolean;
  progressPerc?: number;
  onRename: (newName?: string) => Promise<void>;
  onClick: () => void;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
}) {
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
          Math.min(editorWidth - 170, innerDiv.clientWidth - 170)
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
    <div
      id="sb-top"
      className={syncFailures > 1 ? "sb-sync-error" : undefined}
      onClick={onClick}
    >
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
              {progressPerc !== undefined &&
                (
                  <div className="progress-wrapper" title={`${progressPerc}%`}>
                    <div
                      className="progress-bar"
                      style={`background: radial-gradient(closest-side, white 79%, transparent 80% 100%), conic-gradient(#282828 ${progressPerc}%, #adadad 0);`}
                    >
                      {progressPerc}%
                    </div>
                  </div>
                )}
              {actionButtons.map((actionButton) => {
                const button = (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      actionButton.callback();
                    }}
                    title={actionButton.description}
                    className={actionButton.class}
                  >
                    <actionButton.icon size={18} />
                  </button>
                );

                return actionButton.href !== undefined
                  ? <a href={actionButton.href}>{button}</a>
                  : button;
              })}
            </div>
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
