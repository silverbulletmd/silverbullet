import { useState } from "preact/hooks";
import { api } from "../api.ts";

export function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await api("POST", "api/login", { username, password });
        if (r.status === "ok") onDone();
        else setError(r.error ?? "Login failed");
      }}
    >
      <h1>SilverBullet Muti Space Admin</h1>
      {error && <p class="sb-admin-error">{error}</p>}
      <label for="login-username">Username</label>
      <input
        id="login-username"
        type="text"
        value={username}
        onInput={(e) => setUsername(e.currentTarget.value)}
      />
      <label for="login-password">Password</label>
      <input
        id="login-password"
        type="password"
        value={password}
        onInput={(e) => setPassword(e.currentTarget.value)}
      />
      <div class="row">
        <button type="submit">Log in</button>
      </div>
    </form>
  );
}
