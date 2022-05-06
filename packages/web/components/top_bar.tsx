import { ActionButton, Notification } from "../types";

function prettyName(s: string | undefined): string {
  if (!s) {
    return "";
  }
  return s.replaceAll("/", " / ");
}

export function TopBar({
  pageName,
  unsavedChanges,
  notifications,
  actionButtons,
  onClick,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  notifications: Notification[];
  actionButtons: ActionButton[];
  onClick: () => void;
  lhs?: React.ReactNode;
  rhs?: React.ReactNode;
}) {
  return (
    <div id="top" onClick={onClick}>
      {lhs}
      <div className="main">
        <div className="inner">
          <span
            className={`current-page ${unsavedChanges ? "unsaved" : "saved"}`}
          >
            {prettyName(pageName)}
          </span>
          {notifications.length > 0 && (
            <div className="status">
              {notifications.map((notification) => (
                <div key={notification.id}>{notification.message}</div>
              ))}
            </div>
          )}
          <div className="actions">
            {actionButtons.map((actionButton, idx) => (
              <button
                key={idx}
                onClick={(e) => {
                  e.stopPropagation();
                  actionButton.run();
                }}
                title={actionButton.tooltip}
              >
                {actionButton.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
