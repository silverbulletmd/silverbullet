import { faRunning } from "@fortawesome/free-solid-svg-icons";
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
  onActionClick,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  notifications: Notification[];
  onClick: () => void;
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
            <div className="status">
              {notifications.map((notification) => (
                <div key={notification.id}>{notification.message}</div>
              ))}
            </div>
          )}
          <div className="actions">
            <button
              onClick={(e) => {
                // setMenuExpanded(!menuExpanded);
                onActionClick();
                e.stopPropagation();
              }}
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
