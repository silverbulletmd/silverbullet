import type { ComponentChildren, FunctionalComponent } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Notification } from "@silverbulletmd/silverbullet/type/client";
import { Input } from "@silverbulletmd/silverbullet/ui";

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
  return createPortal(
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
    </div>,
    document.body,
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

function PageNameEditor({
  pageName,
  readOnly,
  onRename,
}: {
  pageName?: string;
  readOnly: boolean;
  onRename: (newName?: string) => Promise<void>;
}) {
  const [name, setName] = useState(pageName ?? "");
  // Guards against the blur that fires when a successful rename refocuses the
  // editor, which would otherwise trigger a second (same-name) commit.
  const committing = useRef(false);
  // Re-sync when navigating to a different page.
  useEffect(() => setName(pageName ?? ""), [pageName]);

  const commit = (newName: string) => {
    if (committing.current) {
      return;
    }
    if (newName !== pageName) {
      committing.current = true;
      // On failure, restore the previous name
      Promise.resolve(onRename(newName))
        .catch(() => setName(pageName ?? ""))
        .finally(() => {
          committing.current = false;
        });
    } else {
      void onRename();
    }
  };

  return (
    <Input
      class="sb-page-name-editor"
      value={name}
      readOnly={readOnly}
      onInput={(e) => setName(e.currentTarget.value)}
      onConfirm={(value) => commit(value)}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
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
  progressPercentage,
  progressType,
  lhs,
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
  progressPercentage?: number;
  progressType?: string;
  onRename: (newName?: string) => Promise<void>;
  onDismissNotification: (id: number) => void;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
  pageNamePrefix?: string;
  cssClass?: string;
  mobileMenuStyle?: string;
  readOnly: boolean;
}) {
  return (
    <div id="sb-top" className={isOnline ? undefined : "sb-sync-error"}>
      {lhs}
      <div className="main">
        <div className="inner">
          <div className="wrapper">
            <div className="sb-page-prefix">{pageNamePrefix}</div>
            <span
              id="sb-current-page"
              className={pageNameClass(isLoading, unsavedChanges, cssClass)}
            >
              <PageNameEditor
                pageName={pageName}
                readOnly={readOnly}
                onRename={onRename}
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
            {mobileMenuStyle ? (
              <>
                <ActionButtons
                  buttons={actionButtons.filter((b) => b.dropdown === false)}
                />
                <ActionButtons
                  buttons={actionButtons.filter((b) => b.dropdown !== false)}
                  mobileMenuStyle={mobileMenuStyle}
                />
              </>
            ) : (
              <ActionButtons buttons={actionButtons} />
            )}
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
