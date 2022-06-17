import { useEffect, useState } from "react";
import { ShortcutItem, Notification } from "../types";

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
  shortcutItems,
  onClick,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  notifications: Notification[];
  shortcutItems: ShortcutItem[];
  onClick: () => void;
  lhs?: React.ReactNode;
  rhs?: React.ReactNode;
}) {
  const [menuExpanded, setMenuExpanded] = useState(false);

  useEffect(() => {
    function closer() {
      setMenuExpanded(false);
    }

    document.addEventListener("click", closer);

    return () => {
      document.removeEventListener("click", closer);
    };
  }, []);

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
                setMenuExpanded(!menuExpanded);
                e.stopPropagation();
              }}
            >
              ...
            </button>
            {menuExpanded && (
              <ul>
                {shortcutItems.map((actionButton, idx) => (
                  <li key={idx}>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuExpanded(false);
                        actionButton.run();
                      }}
                    >
                      {actionButton.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
