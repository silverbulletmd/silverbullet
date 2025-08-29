import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { ComponentChildren, FunctionalComponent } from "preact";
import type { Notification } from "@silverbulletmd/silverbullet/type/client";
import type { FeatherProps } from "preact-feather/types";
import type { IconBaseProps } from "react-icons/types";
import { MiniEditor } from "./mini_editor.tsx";

export type ActionButton = {
  icon: FunctionalComponent<FeatherProps | IconBaseProps>;
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
  notifications,
  onRename,
  actionButtons,
  darkMode,
  vimMode,
  progressPercentage,
  progressType,
  completer,
  lhs,
  onClick,
  rhs,
  pageNamePrefix,
  cssClass,
  mobileMenuStyle,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  syncFailures: number;
  isLoading: boolean;
  notifications: Notification[];
  darkMode?: boolean;
  vimMode: boolean;
  progressPercentage?: number;
  progressType?: string;
  onRename: (newName?: string) => Promise<void>;
  onClick: () => void;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
  pageNamePrefix?: string;
  cssClass?: string;
  mobileMenuStyle?: string;
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
            <div className="sb-page-prefix">{pageNamePrefix}</div>
            <span
              id="sb-current-page"
              className={(isLoading
                ? "sb-loading"
                : unsavedChanges
                ? "sb-unsaved"
                : "sb-saved") +
                (cssClass ? " sb-decorated-object " + cssClass : "")}
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
                editable={!client.ui.viewState.uiOptions.forcedROMode &&
                  !client.clientConfig.readOnly}
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
            <div className="sb-sync-progress">
              {progressPercentage !== undefined &&
                (
                  <div
                    className="progress-wrapper"
                    title={`${progressType} progress: ${progressPercentage}%`}
                  >
                    <div
                      className="progress-bar"
                      style={`background: radial-gradient(closest-side, var(--top-background-color) 79%, transparent 80% 100%), conic-gradient(var(--progress-${progressType}-color) ${progressPercentage}%, var(--progress-background-color) 0);`}
                    >
                      {progressPercentage}
                    </div>
                  </div>
                )}
            </div>
            <div
              className={"sb-actions " +
                (mobileMenuStyle ? mobileMenuStyle : "")}
            >
              {actionButtons.map((actionButton) => {
                const button = (
                  <button
                    type="button"
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

                return actionButton.href
                  ? (
                    <a href={actionButton.href} key={actionButton.href}>
                      {button}
                    </a>
                  )
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
