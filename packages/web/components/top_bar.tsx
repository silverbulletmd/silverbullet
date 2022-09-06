import {
  faRunning,
  faHome,
  faSun,
  faMoon,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
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
  isLoading,
  notifications,
  onClick,
  onThemeClick,
  onHomeClick,
  onActionClick,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  isLoading: boolean;
  notifications: Notification[];
  onClick: () => void;
  onThemeClick: () => void;
  onHomeClick: () => void;
  onActionClick: () => void;
  lhs?: React.ReactNode;
  rhs?: React.ReactNode;
}) {
  const [theme, setTheme] = useState<string>(localStorage.theme ?? "light");

  return (
    <div id="sb-top" onClick={onClick}>
      {lhs}
      <div className="main">
        <div className="inner">
          <span
            className={`sb-current-page ${
              isLoading
                ? "sb-loading"
                : unsavedChanges
                ? "sb-unsaved"
                : "sb-saved"
            }`}
          >
            {prettyName(pageName)}
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
            <button
              onClick={(e) => {
                onThemeClick();
                setTheme(localStorage.theme ?? "light");
                e.stopPropagation();
              }}
              title="Toggle theme"
            >
              <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
            </button>
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
