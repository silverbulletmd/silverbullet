import { Notification } from "../types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileLines } from "@fortawesome/free-solid-svg-icons";

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
}: {
  pageName?: string;
  unsavedChanges: boolean;
  notifications: Notification[];
  onClick: () => void;
}) {
  return (
    <div id="top" onClick={onClick}>
      <div className="inner">
        <span className={`icon ${unsavedChanges ? "unsaved" : "saved"}`}>
          <FontAwesomeIcon icon={faFileLines} />
        </span>
        <span className="current-page">{prettyName(pageName)}</span>
        {notifications.length > 0 && (
          <div className="status">
            {notifications.map((notification) => (
              <div key={notification.id}>{notification.message}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
