/** Mirrors `update_check::Answer` on the Server: what silverbullet.md answered, empty when the check is off. */
export type Advisory = {
  id: string;
  fixedIn: string;
  severity: string;
  summary: string;
  url: string;
};
export type Update = { version: string; url: string; title: string };
export type UpdateCheckAnswer = { update: Update | null; security: Advisory[] };

export type Notice =
  | { kind: "security"; advisories: Advisory[] }
  | { kind: "update"; update: Update }
  | null;

/** localStorage key holding the release version whose update notice the admin hid. */
export const DISMISSED_UPDATE_KEY = "sb.dashboard.dismissedUpdate";

/** Security warnings always show; an update shows unless the admin hid that version. */
export function updateNotice(
  answer: UpdateCheckAnswer,
  dismissedVersion: string | null,
): Notice {
  if (answer.security.length > 0) {
    return { kind: "security", advisories: answer.security };
  }
  if (answer.update && answer.update.version !== dismissedVersion) {
    return { kind: "update", update: answer.update };
  }
  return null;
}
