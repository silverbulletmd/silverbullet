import { faRunning, faHome } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Notification } from "../types";

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
  onClick,
  onHomeClick,
  onActionClick,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  notifications: Notification[];
  onClick: () => void;
  onHomeClick: () => void;
  onActionClick: () => void;
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
            <div className="notifications">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`notification-${notification.type}`}
                >
                  {notification.message}
                </div>
              ))}
            </div>
          )}
          <div className="actions">
            <button
              onClick={(e) => {
                onHomeClick();
                e.stopPropagation();
              }}
              title="Navigate to the 'index' page"
            >
              <FontAwesomeIcon icon={faHome} />
            </button>
            <button
              onClick={(e) => {
                onActionClick();
                e.stopPropagation();
              }}
              title="Open the command palette"
            >
              <FontAwesomeIcon icon={faRunning} />
            </button>
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
