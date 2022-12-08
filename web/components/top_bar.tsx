import { useRef } from "../deps.ts";
import { ComponentChildren } from "../deps.ts";
import { Notification } from "../types.ts";
import { FunctionalComponent } from "https://esm.sh/v99/preact@10.11.1/src/index";
import { FeatherProps } from "https://esm.sh/v99/preact-feather@4.2.1/dist/types";

function prettyName(s: string | undefined): string {
  if (!s) {
    return "";
  }
  return s.replaceAll("/", " / ");
}

export type ActionButton = {
  icon: FunctionalComponent<FeatherProps>;
  description: string;
  callback: () => void;
};

export function TopBar({
  pageName,
  unsavedChanges,
  isLoading,
  notifications,
  onRename,
  actionButtons,
  lhs,
  rhs,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  isLoading: boolean;
  notifications: Notification[];
  onRename: (newName?: string) => void;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
}) {
  // const [theme, setTheme] = useState<string>(localStorage.theme ?? "light");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div id="sb-top">
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
            <input
              type="text"
              ref={inputRef}
              value={pageName}
              className="sb-edit-page-name"
              onBlur={(e) => {
                (e.target as any).value = pageName;
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  const newName = (e.target as any).value;
                  onRename(newName);
                }
                if (e.key === "Escape") {
                  onRename();
                }
              }}
            />
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
                <actionButton.icon size={18} />
              </button>
            ))}
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
