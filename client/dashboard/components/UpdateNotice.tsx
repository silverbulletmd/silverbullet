import { useEffect, useState } from "preact/hooks";
import { Alert, Button } from "@silverbulletmd/silverbullet/ui";
import { getServerInfo } from "../api.ts";
import {
  DISMISSED_UPDATE_KEY,
  type Notice,
  updateNotice,
} from "../update_notice.ts";

// Storage can be unavailable (private windows, blocked site data); the notice then just shows.
function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string) {
  try {
    localStorage.setItem(DISMISSED_UPDATE_KEY, version);
  } catch {
    // Hidden for this page view only.
  }
}

export function UpdateNotice() {
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    let live = true;
    getServerInfo()
      .then(
        (info) =>
          live && setNotice(updateNotice(info.updateCheck, readDismissed())),
      )
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!notice) return null;
  if (notice.kind === "security") {
    return (
      <Alert variant="error" class="sb-update-notice">
        {notice.advisories.map((a) => (
          <p key={a.id}>
            This SilverBullet version has a known security issue: {a.summary}.
            Update to {a.fixedIn} or later.{" "}
            <a href={a.url} target="_blank" rel="noopener">
              Details
            </a>
          </p>
        ))}
      </Alert>
    );
  }
  return (
    <Alert variant="info" class="sb-update-notice sb-update-notice-dismissible">
      <span>
        SilverBullet {notice.update.version} is available:{" "}
        <a href={notice.update.url} target="_blank" rel="noopener">
          {notice.update.title}
        </a>
      </span>
      <Button
        variant="icon"
        aria-label="Hide update notice"
        title="Hide until the next release"
        onClick={() => {
          writeDismissed(notice.update.version);
          setNotice(null);
        }}
      >
        ×
      </Button>
    </Alert>
  );
}
