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
  linkOidc,
  listUsers,
  setFullName,
  setUserAdmin,
  setUserPassword,
  setUserProfile,
  unlinkOidc,
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
                      {user.fullName !== name && (
                        <div class="sb-help-text">{user.fullName}</div>
                      )}
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
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        createUser(username, password, admin, fullName, email)
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
      <label for="new-user-full-name">Full name</label>
      <Input
        id="new-user-full-name"
        value={fullName}
        onInput={(event) => setFullName(event.currentTarget.value)}
      />
      <label for="new-user-email">Email</label>
      <Input
        id="new-user-email"
        value={email}
        onInput={(event) => setEmail(event.currentTarget.value)}
      />
      <p class="sb-help-text">Used to attribute changes in revision history.</p>
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
  const [nameOverride, setNameOverride] = useState("");
  const [email, setEmail] = useState("");
  const [linkIssuer, setLinkIssuer] = useState("");
  const [linkSubject, setLinkSubject] = useState("");
  const isSelf = username === currentUsername;

  async function reload() {
    try {
      const user = await getUser(username);
      setUser(user);
      // Prefill the editor only when an admin override exists; otherwise an
      // empty input means "follow the provider / account name".
      setNameOverride(
        user.fullNameSource === "admin" ? (user.fullName ?? "") : "",
      );
      setEmail(user.email ?? "");
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
      <details>
        <summary>Advanced</summary>
        <section>
          <h2>Display name</h2>
          <p class="sb-help-text">
            {user.fullNameSource === "admin"
              ? "Custom override — single sign-on will not change this name."
              : "Follows the SSO provider's name claim when available; otherwise the account name is shown."}
          </p>
          <div class="row">
            <Input
              aria-label="Display name"
              placeholder={username}
              value={nameOverride}
              onInput={(event) => setNameOverride(event.currentTarget.value)}
            />
            <Button
              variant="primary"
              onClick={() =>
                void run(async () => {
                  await setFullName(username, nameOverride.trim() || null);
                  await reload();
                })
              }
            >
              Save
            </Button>
            {user.fullNameSource === "admin" && (
              <Button
                onClick={() =>
                  void run(async () => {
                    await setFullName(username, null);
                    setNameOverride("");
                    await reload();
                  })
                }
              >
                Reset to automatic
              </Button>
            )}
          </div>
        </section>
        <section>
          <h2>Single sign-on</h2>
          {user.oidcIssuer ? (
            <>
              <p class="sb-help-text">
                This account signs in via single sign-on with these claims.
              </p>
              <label for="oidc-issuer">Issuer</label>
              <Input
                id="oidc-issuer"
                readOnly
                value={user.oidcIssuer}
                onFocus={(event) => event.currentTarget.select()}
              />
              <label for="oidc-subject">Subject</label>
              <Input
                id="oidc-subject"
                readOnly
                value={user.oidcSubject ?? ""}
                onFocus={(event) => event.currentTarget.select()}
              />
              <div class="row">
                <Button
                  variant="danger"
                  onClick={() =>
                    void run(async () => {
                      if (
                        !confirm(
                          `Unlink single sign-on from "${username}"? They will only be able to sign in with a password.`,
                        )
                      ) {
                        return;
                      }
                      await unlinkOidc(username);
                      await reload();
                    })
                  }
                >
                  Unlink
                </Button>
              </div>
            </>
          ) : (
            <>
              <p class="sb-help-text">
                Link this account to a single sign-on identity by pasting its{" "}
                <code>iss</code> and <code>sub</code> claims from an ID token.
              </p>
              <label for="oidc-link-issuer">Issuer URL</label>
              <Input
                id="oidc-link-issuer"
                placeholder="https://provider.example/..."
                value={linkIssuer}
                onInput={(event) => setLinkIssuer(event.currentTarget.value)}
              />
              <label for="oidc-link-subject">Subject</label>
              <Input
                id="oidc-link-subject"
                placeholder="Subject identifier (sub claim)"
                value={linkSubject}
                onInput={(event) => setLinkSubject(event.currentTarget.value)}
              />
              <div class="row">
                <Button
                  variant="primary"
                  disabled={!linkIssuer.trim() || !linkSubject.trim()}
                  onClick={() =>
                    void run(async () => {
                      await linkOidc(
                        username,
                        linkIssuer.trim(),
                        linkSubject.trim(),
                      );
                      await reload();
                    })
                  }
                >
                  Link
                </Button>
              </div>
            </>
          )}
        </section>
      </details>
      <section>
        <h2>Contact</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await setUserProfile(username, user.fullName ?? "", email);
              await reload();
            });
          }}
        >
          <label for="user-detail-email">Email</label>
          <Input
            id="user-detail-email"
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
          <div class="row">
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
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
