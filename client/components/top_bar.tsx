import type { ComponentChildren, FunctionalComponent } from "preact";
import type { Notification } from "@silverbulletmd/silverbullet/type/client";
import { MiniEditor } from "./mini_editor.tsx";

export type ActionButton = {
  icon: FunctionalComponent<any>;
  description: string;
  class?: string;
  callback: () => void;
  href?: string;
  mobile?: boolean;
  dropdown?: boolean;
};

function pageNameClass(
  isLoading: boolean,
  unsavedChanges: boolean,
  cssClass?: string,
): string {
  const state = isLoading
    ? "sb-loading"
    : unsavedChanges
      ? "sb-unsaved"
      : "sb-saved";
  return cssClass ? `${state} sb-decorated-object ${cssClass}` : state;
}

function NotificationPanel({
  notifications,
  onDismiss,
}: {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}) {
  if (notifications.length === 0) return null;
  return (
    <div className="sb-notifications">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`sb-notification-${notification.type}`}
        >
          <span className="sb-notification-message">
            {notification.message}
          </span>
          {notification.actions && notification.actions.length > 0 && (
            <span className="sb-notification-actions">
              {notification.actions.map((action, i) => (
                <button
                  key={i}
                  className="sb-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    action.run();
                  }}
                >
                  {action.name}
                </button>
              ))}
            </span>
          )}
          {notification.persistent && (
            <button
              className="sb-notification-dismiss"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(notification.id);
              }}
            >
              &times;
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function SyncProgressIndicator({
  percentage,
  type,
}: {
  percentage?: number;
  type?: string;
}) {
  if (percentage === undefined) return null;
  return (
    <div className="sb-sync-progress">
      <div
        className="progress-wrapper"
        title={`${type} progress: ${percentage}%`}
      >
        <div
          className="progress-bar"
          style={`background: radial-gradient(closest-side, var(--top-background-color) 79%, transparent 80% 100%), conic-gradient(var(--progress-${type}-color) ${percentage}%, var(--progress-background-color) 0);`}
        >
          {percentage}
        </div>
      </div>
    </div>
  );
}

function ActionButtons({
  buttons,
  mobileMenuStyle,
}: {
  buttons: ActionButton[];
  mobileMenuStyle?: string;
}) {
  return (
    <div className={`sb-actions ${mobileMenuStyle ?? ""}`}>
      {buttons.map((actionButton) => {
        const btn = (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              actionButton.callback();
            }}
            onBlur={() => {
              if (mobileMenuStyle === "hamburger") {
                document
                  .querySelector("#sb-top .sb-actions.hamburger")
                  ?.classList.remove("open");
              }
            }}
            title={actionButton.description}
            className={actionButton.class}
          >
            <actionButton.icon size={18} />
          </button>
        );
        return actionButton.href ? (
          <a href={actionButton.href} key={actionButton.href}>
            {btn}
          </a>
        ) : (
          btn
        );
      })}
    </div>
  );
}

export function TopBar({
  pageName,
  unsavedChanges,
  isOnline,
  isLoading,
  notifications,
  onRename,
  onDismissNotification,
  actionButtons,
  darkMode,
  progressPercentage,
  progressType,
  lhs,
  onClick,
  rhs,
  pageNamePrefix,
  cssClass,
  mobileMenuStyle,
  readOnly,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  isOnline: boolean;
  isLoading: boolean;
  notifications: Notification[];
  darkMode?: boolean;
  progressPercentage?: number;
  progressType?: string;
  onRename: (newName?: string) => Promise<void>;
  onDismissNotification: (id: number) => void;
  onClick: () => void;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
  pageNamePrefix?: string;
  cssClass?: string;
  mobileMenuStyle?: string;
  readOnly: boolean;
}) {
  return (
    <div
      id="sb-top"
      className={isOnline ? undefined : "sb-sync-error"}
      onClick={onClick}
    >
      {lhs}
      <div className="main">
        <div className="inner">
          <div className="wrapper">
            <div className="sb-page-prefix">{pageNamePrefix}</div>
            <span
              id="sb-current-page"
              className={pageNameClass(isLoading, unsavedChanges, cssClass)}
            >
              <MiniEditor
                text={pageName ?? ""}
                darkMode={darkMode}
                onBlur={(newName) => {
                  if (newName !== pageName) {
                    return onRename(newName);
                  } else {
                    return onRename();
                  }
                }}
                onEnter={(newName) => {
                  void onRename(newName);
                }}
                editable={!readOnly}
              />
            </span>
            <NotificationPanel
              notifications={notifications}
              onDismiss={onDismissNotification}
            />
            <SyncProgressIndicator
              percentage={progressPercentage}
              type={progressType}
            />
            {mobileMenuStyle
              ? (
                <>
                  <ActionButtons
                    buttons={actionButtons.filter((b) =>
                      b.dropdown === false
                    )}
                  />
                  <ActionButtons
                    buttons={actionButtons.filter((b) =>
                      b.dropdown !== false
                    )}
                    mobileMenuStyle={mobileMenuStyle}
                  />
                </>
              )
              : <ActionButtons buttons={actionButtons} />}
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
