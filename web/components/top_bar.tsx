// import { Fragment, h } from "../deps.ts";

import { FontAwesomeIcon, useRef } from "../deps.ts";

import {
  ComponentChildren,
  IconDefinition,
  useEffect,
  useState,
} from "../deps.ts";
import { Notification } from "../types.ts";
import { isMacLike } from "../../common/util.ts";

function prettyName(s: string | undefined): string {
  if (!s) {
    return "";
  }
  return s.replaceAll("/", " / ");
}

export type ActionButton = {
  icon: IconDefinition;
  description: string;
  callback: () => void;
};

export function TopBar({
  pageName,
  unsavedChanges,
  isLoading,
  editMode,
  notifications,
  onClick,
  onBlur,
  onRename,
  actionButtons,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  editMode: boolean;
  isLoading: boolean;
  notifications: Notification[];
  onClick: () => void;
  onBlur: () => void;
  onRename: (newName: string) => void;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
}) {
  const [theme, setTheme] = useState<string>(localStorage.theme ?? "light");
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = isMacLike();

  useEffect(() => {
    if (editMode) {
      setTimeout(() => {
        if (inputRef.current) {
          console.log("Going to focus");
          inputRef.current!.focus();
        }
      }, 0);
    }
  }, [editMode]);

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
            {editMode
              ? (
                <input
                  type="text"
                  ref={inputRef}
                  value={pageName}
                  className="sb-edit-page-name"
                  onBlur={onBlur}
                  onKeyDown={(e) => {
                    console.log("Key press", e);
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const newName = (e.target as any).value;
                      onRename(newName);
                    }
                  }}
                />
              )
              : prettyName(pageName)}
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
            {actionButtons.map((actionButton) => (
              <button
                onClick={(e) => {
                  actionButton.callback();
                  e.stopPropagation();
                }}
                title={actionButton.description}
              >
                <FontAwesomeIcon icon={actionButton.icon} />
              </button>
            ))}
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
