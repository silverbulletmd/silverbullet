import { useEffect, useState } from "preact/hooks";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Input,
} from "@silverbulletmd/silverbullet/ui";
import {
  createToken,
  createUser,
  deleteToken,
  deleteUser,
  formatApiError,
  getUser,
  listUsers,
  setUserAdmin,
  setUserPassword,
} from "../api.ts";
import { useNavigate } from "../navigation.ts";
import { spacesUrl } from "../routes.ts";
import type { UserInfo } from "../types.ts";

function useUserList(onUnauthorized: () => void) {
  const [users, setUsers] = useState<Record<string, UserInfo>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    listUsers()
      .then((users) => {
        setUsers(users);
        setLoaded(true);
      })
      .catch((error: any) => {
        if (error.unauthorized) onUnauthorized();
        else setError(formatApiError(error));
        setLoaded(true);
      });
  }, []);
  return { users, loaded, error };
}

export function UserList({
  currentUsername,
  onUnauthorized,
}: {
  currentUsername: string;
  onUnauthorized: () => void;
}) {
  const { users, loaded, error } = useUserList(onUnauthorized);
  return (
    <div>
      {/* No heading: this screen is only ever reached from the tab bar, which
          already names it. See SpaceList for the non-admin case. */}
      {error && <Alert variant="error">{error}</Alert>}
      {!loaded && <p>Loading…</p>}
      {loaded && Object.keys(users).length === 0 && <p>No users yet.</p>}
      {loaded && Object.keys(users).length > 0 && (
        <table class="sb-user-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              {/* Actions column; the header stays empty. */}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(users)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([name, user]) => {
                const href = spacesUrl(`/users/${encodeURIComponent(name)}`);
                return (
                  <tr key={name}>
                    <td>
                      <a class="sb-user-link" href={href}>
                        {name}
                      </a>{" "}
                      {name === currentUsername && <Badge>you</Badge>}
                    </td>
                    <td>{user.admin ? "admin" : "user"}</td>
                    <td>
                      {/* Same destination as the name — an explicit control
                          for anyone who doesn't read the name as clickable,
                          mirroring the spaces list. */}
                      <a class="sb-button sb-user-edit" href={href}>
                        Edit
                      </a>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
      {loaded && (
        <div class="row">
          <a class="sb-button sb-button-primary" href={spacesUrl("/users/new")}>
            Create user
          </a>
        </div>
      )}
    </div>
  );
}

export function NewUser({ onUnauthorized }: { onUnauthorized: () => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        createUser(username, password, admin)
          .then(() =>
            navigate(
              spacesUrl(`/users/${encodeURIComponent(username.trim())}`),
            ),
          )
          .catch((error: any) => {
            if (error.unauthorized) onUnauthorized();
            else setError(formatApiError(error));
          });
      }}
    >
      <h1>Create user</h1>
      {error && <Alert variant="error">{error}</Alert>}
      <label for="new-user-username">Username</label>
      <Input
        id="new-user-username"
        value={username}
        onInput={(event) => setUsername(event.currentTarget.value)}
      />
      <label for="new-user-password">Password</label>
      <Input
        id="new-user-password"
        type="password"
        value={password}
        onInput={(event) => setPassword(event.currentTarget.value)}
      />
      <label>
        <Checkbox
          checked={admin}
          onChange={(event) => setAdmin(event.currentTarget.checked)}
        />{" "}
        Admin
      </label>
      <div class="row">
        <Button type="submit" variant="primary">
          Create user
        </Button>
        <a class="sb-button" href={spacesUrl("/users")}>
          Cancel
        </a>
      </div>
    </form>
  );
}

export function UserDetail({
  username,
  currentUsername,
  onUnauthorized,
}: {
  username: string;
  currentUsername: string;
  onUnauthorized: () => void;
}) {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [shownToken, setShownToken] = useState<string | undefined>();
  const isSelf = username === currentUsername;

  async function reload() {
    try {
      setUser(await getUser(username));
      setError("");
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
      else if (error.notFound) setNotFound(true);
      else setError(formatApiError(error));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void reload();
  }, [username]);

  async function run(action: () => Promise<void>) {
    try {
      await action();
      setError("");
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
      else setError(formatApiError(error));
    }
  }

  if (!loaded) return <p>Loading…</p>;
  if (notFound) {
    return (
      <div>
        <h1>User not found</h1>
        <p>
          <a href={spacesUrl("/users")}>Return to users</a>
        </p>
      </div>
    );
  }
  if (!user) return <Alert variant="error">{error || "User not found"}</Alert>;
  const tokenNames = Object.keys(user.tokens);
  return (
    <div>
      <h1>
        {username} {isSelf && <Badge>you</Badge>}
      </h1>
      {error && <Alert variant="error">{error}</Alert>}
      <section>
        <h2>Role</h2>
        <label>
          <Checkbox
            checked={user.admin}
            onChange={(event) => {
              const admin = event.currentTarget.checked;
              if (
                isSelf &&
                !admin &&
                !confirm(
                  `Remove admin rights from your own account "${username}"? Your session will lose admin access immediately.`,
                )
              ) {
                event.currentTarget.checked = true;
                return;
              }
              void run(async () => {
                await setUserAdmin(username, admin);
                if (isSelf && !admin) location.assign("/");
                else await reload();
              });
            }}
          />{" "}
          Administrator
        </label>
      </section>
      <section>
        <h2>Password</h2>
        <div class="row">
          <Input
            type="password"
            aria-label="New password"
            placeholder="New password"
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
          <Button
            variant="primary"
            onClick={() =>
              void run(async () => {
                await setUserPassword(username, password);
                setPassword("");
                if (isSelf) location.assign(loginUrlForUser(username));
              })
            }
          >
            Set password
          </Button>
        </div>
      </section>
      <section>
        <h2>API tokens</h2>
        {tokenNames.length === 0 && <p>No tokens.</p>}
        {tokenNames.length > 0 && (
          <ul class="sb-token-list">
            {tokenNames.map((name) => (
              <li key={name}>
                <strong>{name}</strong>
                <span>
                  created{" "}
                  {new Date(user.tokens[name].createdAt).toLocaleString()}
                </span>
                <Button
                  onClick={() => {
                    if (!confirm(`Revoke token "${name}" for "${username}"?`)) {
                      return;
                    }
                    void run(async () => {
                      await deleteToken(username, name);
                      await reload();
                    });
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div class="row">
          <Input
            aria-label="Token name"
            placeholder="Token name"
            value={tokenName}
            onInput={(event) => setTokenName(event.currentTarget.value)}
          />
          <Button
            variant="primary"
            onClick={() => {
              const name = tokenName.trim();
              if (!name) return;
              void run(async () => {
                setShownToken(await createToken(username, name));
                setTokenName("");
                await reload();
              });
            }}
          >
            Create token
          </Button>
        </div>
        {shownToken && (
          <div class="sb-token-reveal">
            <Alert variant="warning">
              This token is shown only once — copy it now.
            </Alert>
            <Input
              readOnly
              value={shownToken}
              onClick={(event) => event.currentTarget.select()}
            />
            <Button onClick={() => setShownToken(undefined)}>Dismiss</Button>
          </div>
        )}
      </section>
      <div class="sb-danger-zone">
        <Button
          variant="danger"
          onClick={() => {
            const message = isSelf
              ? `Delete your own account "${username}"? You will be logged out immediately.`
              : `Delete user "${username}"?`;
            if (!confirm(message)) return;
            void run(async () => {
              await deleteUser(username);
              // Deleting your own account ends the session, so that one has
              // to be a real navigation out of the app.
              if (isSelf) location.assign("/");
              else navigate(spacesUrl("/users"));
            });
          }}
        >
          Delete user
        </Button>
      </div>
    </div>
  );
}

function loginUrlForUser(username: string): string {
  const next = spacesUrl(`/users/${encodeURIComponent(username)}`);
  return `${spacesUrl("/login")}?next=${encodeURIComponent(next)}`;
}
