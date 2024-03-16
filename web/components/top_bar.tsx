import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { ComponentChildren, FunctionalComponent } from "preact";
import { Notification } from "$lib/web.ts";
import { FeatherProps } from "preact-feather/types";
import { MiniEditor } from "./mini_editor.tsx";

export type ActionButton = {
  icon: FunctionalComponent<FeatherProps>;
  description: string;
  class?: string;
  callback: () => void;
  href?: string;
  mobile?: boolean;
};

export function TopBar({
  pageName,
  unsavedChanges,
  syncFailures,
  isLoading,
  isMobile,
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
  isMobile: boolean;
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
