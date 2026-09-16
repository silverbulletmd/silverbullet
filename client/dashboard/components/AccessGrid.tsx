import { Badge, Checkbox } from "@silverbulletmd/silverbullet/ui";
import type {
  MemberEntry,
  MemberRole,
  SpaceAccess,
  UserInfo,
} from "../types.ts";

const PERMISSIONS: {
  role: MemberRole;
  label: string;
  requiresWrite: boolean;
}[] = [
  { role: "read", label: "Read", requiresWrite: false },
  { role: "write", label: "Write", requiresWrite: true },
];

export function AccessGrid({
  users,
  members,
  frozen,
  onChange,
  runtimeAvailable,
  onRuntimeChange,
}: {
  users: Record<string, UserInfo>;
  members: Record<string, MemberEntry>;
  runtimeAvailable: boolean;
  onRuntimeChange: (username: string, enabled: boolean) => void;
  frozen: boolean;
  onChange: (username: string, role: SpaceAccess) => void;
}) {
  return (
    <div class="sb-access-grid-scroll">
      <table class="sb-access-grid" aria-label="User permissions">
        <thead>
          <tr>
            <th scope="col">User</th>
            {PERMISSIONS.map(({ role, label }) => (
              <th scope="col" key={role}>
                {label}
              </th>
            ))}
            <th scope="col">Runtime API</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(users)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([username, user]) => {
              const level = user.admin
                ? PERMISSIONS.length - 1
                : PERMISSIONS.findIndex(
                    ({ role }) => role === members[username]?.role,
                  );
              return (
                <tr key={username}>
                  <th scope="row">
                    {username} {user.admin && <Badge>Admin</Badge>}
                  </th>
                  {PERMISSIONS.map(({ role, label, requiresWrite }, index) => (
                    <td key={role}>
                      <Checkbox
                        aria-label={`${username}: ${label}`}
                        checked={level >= index}
                        disabled={user.admin || (frozen && requiresWrite)}
                        onChange={(event) =>
                          onChange(
                            username,
                            event.currentTarget.checked
                              ? role
                              : (PERMISSIONS[index - 1]?.role ?? "none"),
                          )
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <Checkbox
                      aria-label={`${username}: Runtime API`}
                      checked={
                        !frozen &&
                        level >= 1 &&
                        (user.admin || (members[username]?.runtimeApi ?? true))
                      }
                      disabled={
                        user.admin || frozen || level < 1 || !runtimeAvailable
                      }
                      onChange={(event) =>
                        onRuntimeChange(username, event.currentTarget.checked)
                      }
                    />
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
