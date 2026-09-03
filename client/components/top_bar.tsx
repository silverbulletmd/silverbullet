import type { ComponentChildren, FunctionalComponent } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Notification } from "@silverbulletmd/silverbullet/type/client";
import { Input } from "@silverbulletmd/silverbullet/ui";

export type ActionButton = {
  icon: FunctionalComponent<any>;
  description: string;
  class?: string;
  callback: (el?: HTMLElement) => void;
  href?: string;
  mobile?: boolean;
  dropdown?: boolean;
  hasPopup?: boolean;
  expanded?: boolean;
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

/**
 * Publishes the editor pane's horizontal box so the notification overlay can
 * line up with it. The overlay is portaled to document.body and positioned
 * `fixed`, so it cannot see that #sb-editor is a flex child whose position and
 * width change when a side panel opens.
 */
function useEditorPaneMetrics() {
  // Layout effect, not effect: this runs before paint, so the overlay never
  // renders at the fallback position and then jumps.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const editor = document.querySelector("#sb-editor");
    if (!editor) return;

    const publish = () => {
      const { left, width } = editor.getBoundingClientRect();
      // A zero box means the pane has not been laid out yet; the observer
      // fires again once it has, and the CSS fallbacks hold until then.
      if (width === 0) return;
      root.style.setProperty("--sb-editor-pane-left", `${left}px`);
      root.style.setProperty("--sb-editor-pane-width", `${width}px`);
    };
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(editor);

    return () => {
      observer.disconnect();
      root.style.removeProperty("--sb-editor-pane-left");
      root.style.removeProperty("--sb-editor-pane-width");
    };
  }, []);
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
    <NotificationList notifications={notifications} onDismiss={onDismiss} />,
    document.body,
  );
}

// Split out so the metrics hook mounts only while something is on screen, by
// which point #sb-editor is laid out and the first measurement is real.
function NotificationList({
  notifications,
  onDismiss,
}: {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}) {
  useEditorPaneMetrics();
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
  withLabel,
}: {
  percentage?: number;
  type?: string;
  withLabel?: boolean;
}) {
  if (percentage === undefined) return null;
  return (
    <div className="sb-sync-progress">
      <div
        className="progress-wrapper"
        title={`${type} progress: ${percentage}%`}
      >
        {withLabel && (
          <span className="progress-label">
            {type === "sync" ? "Syncing space" : "Indexing"}
          </span>
        )}
        <div className="progress-bar">
          <div
            className="progress-ring"
            style={`background: conic-gradient(var(--progress-${type}-color) ${percentage}%, var(--progress-background-color) 0);`}
          />
          <div className="progress-hole">{percentage}</div>
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
              actionButton.callback(e.currentTarget as HTMLElement);
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
            aria-haspopup={actionButton.hasPopup ? "menu" : undefined}
            aria-expanded={
              actionButton.hasPopup ? !!actionButton.expanded : undefined
            }
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
  progressWithLabel,
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
  progressWithLabel?: boolean;
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
              withLabel={progressWithLabel}
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
