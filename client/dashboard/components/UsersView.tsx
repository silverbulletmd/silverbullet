import { localDateString } from "@silverbulletmd/silverbullet/lib/dates";
import {
  Alert,
  Badge,
  ButtonLink,
  SlidersIcon,
  Button,
  Checkbox,
  Input,
  Select,
  SectionNav,
} from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import {
  createToken,
  createUser,
  deleteToken,
  deleteUser,
  formatApiError,
  getAuthenticationStatus,
  getUser,
  listUsers,
  setUserAdmin,
  setUserDisabled,
  setUserPassword,
  setUserProfile,
  signOutEverywhere,
} from "../api.ts";
import { useNavigate } from "../navigation.ts";
import { SaveConfirmation, useNotification } from "../notifications.tsx";
import { dashboardUrl } from "../routes.ts";
import type { AuthenticationStatus, UserInfo } from "../types.ts";

export function suggestUsernameFromEmail(email: string): string {
  const parts = email.trim().split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return "";
  return parts[0];
}

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
      <header class="sb-management-heading">
        <h1>Users</h1>
      </header>
      <SaveConfirmation scope="users" />
      {error && <Alert variant="error">{error}</Alert>}
      {!loaded && <p>Loading…</p>}
      {loaded && Object.keys(users).length === 0 && <p>No users yet.</p>}
      {loaded && Object.keys(users).length > 0 && (
        <table class="sb-user-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Last login</th>
              {/* Actions column; the header stays empty. */}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(users)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([name, user]) => {
                const href = dashboardUrl(`/users/${encodeURIComponent(name)}`);
                return (
                  <tr key={name}>
                    <td>
                      <a class="sb-user-link" href={href}>
                        {name}
                      </a>{" "}
                      {name === currentUsername && <Badge>you</Badge>}
                      {user.loginMethod === "sso" && <Badge>SSO</Badge>}
                      {user.disabled && <Badge>disabled</Badge>}
                    </td>
                    <td>{user.admin ? "admin" : "user"}</td>
                    <td>
                      {user.lastLogin ? (
                        <time dateTime={user.lastLogin}>
                          {localDateString(new Date(user.lastLogin))
                            .slice(0, 19)
                            .replace("T", " ")}
                        </time>
                      ) : (
                        "No login recorded"
                      )}
                    </td>
                    <td>
                      <ButtonLink
                        variant="icon"
                        class="sb-user-edit"
                        href={href}
                        aria-label={`Settings for ${name}`}
                        title={`Settings for ${name}`}
                      >
                        <SlidersIcon size={18} aria-hidden="true" />
                      </ButtonLink>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
      {loaded && (
        <div class="row">
          <a
            class="sb-button sb-button-primary"
            href={dashboardUrl("/users/new")}
          >
            Create user
          </a>
        </div>
      )}
    </div>
  );
}

export function NewUser({ onUnauthorized }: { onUnauthorized: () => void }) {
  const notify = useNotification("users");
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loginMethod, setLoginMethod] = useState<"local" | "sso">("local");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [authentication, setAuthentication] =
    useState<AuthenticationStatus | null>(null);

  useEffect(() => {
    getAuthenticationStatus()
      .then(setAuthentication)
      .catch((error: any) => {
        if (error.unauthorized) onUnauthorized();
        else setError(formatApiError(error));
      });
  }, []);

  const provider = authentication?.enabled ? authentication.active : null;
  const emailField = (
    <>
      <label for="new-user-email">Email</label>
      <Input
        id="new-user-email"
        type="email"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        autocomplete="email"
        value={email}
        onInput={(event) => {
          const value = event.currentTarget.value;
          setEmail(value);
          if (loginMethod === "sso" && !usernameEdited) {
            setUsername(suggestUsernameFromEmail(value));
          }
        }}
      />
      <p class="sb-help-text">
        {loginMethod === "sso"
          ? "The provider must return this verified email address on first sign-in."
          : "Used to attribute changes in revision history."}
      </p>
    </>
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        createUser(
          username,
          password,
          admin,
          fullName,
          email,
          loginMethod,
          provider?.providerId,
          loginMethod === "sso" ? email : "",
        )
          .then(() => {
            notify("User created.");
            navigate(
              dashboardUrl(`/users/${encodeURIComponent(username.trim())}`),
            );
          })
          .catch((error: any) => {
            if (error.unauthorized) onUnauthorized();
            else setError(formatApiError(error));
          });
      }}
    >
      <h1>Create user</h1>
      <SaveConfirmation scope="users" />
      {error && <Alert variant="error">{error}</Alert>}
      <label for="new-user-login-method">Login method</label>
      <Select
        id="new-user-login-method"
        value={loginMethod}
        onChange={(event) => {
          const method = event.currentTarget.value as "local" | "sso";
          setLoginMethod(method);
          if (method === "sso" && !usernameEdited) {
            setUsername(suggestUsernameFromEmail(email));
          }
        }}
      >
        <option value="local">Local</option>
        <option value="sso" disabled={!provider}>
          SSO{provider?.buttonLabel ? ` (${provider.buttonLabel})` : ""}
        </option>
      </Select>
      {!provider && authentication && (
        <p class="sb-help-text">Enable an SSO provider to add SSO users.</p>
      )}
      {loginMethod === "sso" && emailField}
      <label for="new-user-username">Username</label>
      <Input
        id="new-user-username"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        autocomplete="username"
        value={username}
        onInput={(event) => {
          setUsername(event.currentTarget.value);
          setUsernameEdited(true);
        }}
      />
      {loginMethod === "local" && (
        <>
          <label for="new-user-password">Password</label>
          <Input
            id="new-user-password"
            type="password"
            autocomplete="new-password"
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </>
      )}
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
        autocomplete="name"
        value={fullName}
        onInput={(event) => setFullName(event.currentTarget.value)}
      />
      {loginMethod === "local" && emailField}
      <div class="row">
        <Button type="submit" variant="primary">
          Create user
        </Button>
        <a class="sb-button" href={dashboardUrl("/users")}>
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
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const notify = useNotification("users");
  const [busy, setBusy] = useState(false);
  const sections = {
    profile: "Profile",
    account: "Account & access",
    security: "Security",
    tokens: "API tokens",
  };
  const requestedSection = new URLSearchParams(location.search).get("section");
  const section =
    requestedSection && Object.hasOwn(sections, requestedSection)
      ? requestedSection
      : "profile";
  const base = dashboardUrl(`/users/${encodeURIComponent(username)}`);
  const sectionUrl = (value: string) =>
    value === "profile" ? base : `${base}?section=${value}`;
  const isSelf = username === currentUsername;

  async function reload(replaceProfile = false) {
    const updated = await getUser(username);
    setUser(updated);
    if (replaceProfile) {
      setFullName(updated.fullName ?? "");
      setEmail(updated.email ?? "");
    }
  }

  useEffect(() => {
    setLoaded(false);
    setNotFound(false);
    setShownToken(undefined);
    setPassword("");
    setTokenName("");
    void run(() => reload(true)).finally(() => setLoaded(true));
  }, [username]);

  async function run(action: () => Promise<void>, message = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    notify("");
    try {
      await action();
      if (message) notify(message);
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
      else if (error.notFound) setNotFound(true);
      else setError(formatApiError(error));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p>Loading…</p>;
  if (notFound) {
    return (
      <div>
        <h1>User not found</h1>
        <p>
          <a href={dashboardUrl("/users")}>Return to users</a>
        </p>
      </div>
    );
  }
  if (!user) return <Alert variant="error">{error || "User not found"}</Alert>;
  const tokenNames = Object.keys(user.tokens);
  return (
    <main class="sb-space-settings">
      <header class="sb-settings-heading">
        <div>
          <h1>
            {username}{" "}
            <span class="sb-badge-group">
              {isSelf && <Badge>you</Badge>}
              {user.loginMethod === "sso" && <Badge>SSO</Badge>}
              {user.disabled && <Badge>disabled</Badge>}
            </span>
          </h1>
        </div>
      </header>
      <div class="sb-settings-layout">
        <SectionNav
          horizontal
          label="User settings"
          active={section}
          items={Object.entries(sections).map(([id, label]) => ({
            id,
            label,
            href: sectionUrl(id),
          }))}
          onSelect={(id) => navigate(sectionUrl(id))}
        />
        <div class="sb-settings-content">
          <SaveConfirmation scope="users" />
          {error && <Alert variant="error">{error}</Alert>}
          <fieldset class="sb-settings-fields" disabled={busy}>
            <section hidden={section !== "account"}>
              <h2>Account</h2>
              <p>
                Login method: {user.loginMethod === "sso" ? "SSO" : "Local"}
                {user.loginMethod === "sso" &&
                  ` · ${
                    user.disabled
                      ? "Disabled"
                      : user.sso?.identity
                        ? "Connected"
                        : "Awaiting first sign-in"
                  }`}
              </p>
              {user.sso && (
                <>
                  <p>Expected email: {user.sso.expectedEmail}</p>
                  {user.sso.identity && (
                    <details>
                      <summary>External identity</summary>
                      <dl>
                        <dt>Issuer</dt>
                        <dd>{user.sso.identity.issuer}</dd>
                        <dt>Subject</dt>
                        <dd>{user.sso.identity.subject}</dd>
                      </dl>
                    </details>
                  )}
                </>
              )}
              <label>
                <Checkbox
                  checked={user.disabled}
                  onChange={(event) => {
                    const disabled = event.currentTarget.checked;
                    void run(
                      async () => {
                        await setUserDisabled(username, disabled);
                        await reload();
                      },
                      disabled ? "Account disabled." : "Account enabled.",
                    );
                  }}
                />{" "}
                Disabled
              </label>
            </section>
            <section hidden={section !== "account"}>
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
                    }, "Account role updated.");
                  }}
                />{" "}
                Administrator
              </label>
            </section>
            <section hidden={section !== "profile"}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await setUserProfile(username, fullName, email);
                    await reload(true);
                  }, "Profile saved.");
                }}
              >
                <label for="user-detail-full-name">Full name</label>
                <Input
                  id="user-detail-full-name"
                  autocomplete="name"
                  value={fullName}
                  onInput={(event) => {
                    setFullName(event.currentTarget.value);
                  }}
                />
                <label for="user-detail-email">Email</label>
                <Input
                  id="user-detail-email"
                  type="email"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck={false}
                  autocomplete="email"
                  value={email}
                  onInput={(event) => {
                    setEmail(event.currentTarget.value);
                  }}
                />
                <div class="row">
                  <Button type="submit" variant="primary">
                    Save
                  </Button>
                </div>
              </form>
            </section>
            {user.loginMethod === "local" && (
              <section hidden={section !== "security"}>
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
                      }, "Password updated.")
                    }
                  >
                    Set password
                  </Button>
                </div>
              </section>
            )}
            <section hidden={section !== "tokens"}>
              {tokenNames.length === 0 && <p>No tokens.</p>}
              {tokenNames.length > 0 && (
                <ul class="sb-token-list">
                  {tokenNames.map((name) => (
                    <li key={name}>
                      <strong>{name}</strong>
                      <span>
                        created{" "}
                        {localDateString(new Date(user.tokens[name].createdAt))
                          .slice(0, 19)
                          .replace("T", " ")}
                      </span>
                      <Button
                        onClick={() => {
                          if (
                            !confirm(
                              `Revoke token "${name}" for "${username}"?`,
                            )
                          ) {
                            return;
                          }
                          void run(async () => {
                            await deleteToken(username, name);
                            await reload();
                          }, "API token revoked.");
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
                    }, "API token created.");
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
                  <Button onClick={() => setShownToken(undefined)}>
                    Dismiss
                  </Button>
                </div>
              )}
            </section>
            <section hidden={section !== "security"}>
              <h2>Sessions</h2>
              <Button
                onClick={() => {
                  const message = isSelf
                    ? `Sign out everywhere for your own account "${username}"? You will be logged out immediately.`
                    : `Sign out every browser session and connected app for "${username}"?`;
                  if (!confirm(message)) return;
                  void run(async () => {
                    await signOutEverywhere(username);
                    if (isSelf) location.assign("/");
                    else await reload();
                  }, "All sessions signed out.");
                }}
              >
                Sign out everywhere
              </Button>
            </section>
            <div class="sb-danger-zone" hidden={section !== "account"}>
              <Button
                variant="danger"
                onClick={() => {
                  const message = isSelf
                    ? `Delete your own account "${username}"? You will be logged out immediately.`
                    : `Delete user "${username}"?`;
                  if (!confirm(message)) return;
                  void run(async () => {
                    await deleteUser(username);
                    if (!isSelf) notify("User deleted.");
                    // Deleting your own account ends the session, so that one has
                    // to be a real navigation out of the app.
                    if (isSelf) location.assign("/");
                    else navigate(dashboardUrl("/users"));
                  });
                }}
              >
                Delete user
              </Button>
            </div>
          </fieldset>
        </div>
      </div>
    </main>
  );
}

function loginUrlForUser(username: string): string {
  const next = dashboardUrl(`/users/${encodeURIComponent(username)}`);
  return `${dashboardUrl("/login")}?next=${encodeURIComponent(next)}`;
}
