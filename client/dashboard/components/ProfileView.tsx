import { Alert, Button, Input, Field } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import { formatApiError, getProfile, setProfile } from "../api.ts";
import { SaveConfirmation, useNotification } from "../notifications.tsx";
import type { ProfileInfo } from "../types.ts";

export function ProfileView({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [profile, setProfileState] = useState<ProfileInfo | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const notify = useNotification("profile");

  async function reload() {
    try {
      const profile = await getProfile();
      setProfileState(profile);
      setFullName(profile.fullName ?? "");
      setEmail(profile.email ?? "");
      setError("");
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
      else setError(formatApiError(error));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function run(action: () => Promise<void>) {
    notify("");
    try {
      await action();
      setError("");
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
      else setError(formatApiError(error));
    }
  }

  if (!loaded)
    return (
      <>
        <header class="sb-management-heading">
          <h1>Profile</h1>
        </header>
        <p>Loading…</p>
      </>
    );
  if (!profile)
    return <Alert variant="error">{error || "Profile not found"}</Alert>;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await setProfile(fullName, email);
          notify("Saved.");
        });
      }}
    >
      <header class="sb-management-heading">
        <h1>Profile</h1>
      </header>
      <SaveConfirmation scope="profile" />
      {error && <Alert variant="error">{error}</Alert>}
      <p class="sb-help-text">
        Used for revision history and collaboration features.
      </p>

      <Field label="Full name">
        <Input
          id="profile-full-name"
          value={fullName}
          onInput={(event) => {
            setFullName(event.currentTarget.value);
          }}
        />
      </Field>
      <Field label="Email">
        <Input
          id="profile-email"
          value={email}
          onInput={(event) => {
            setEmail(event.currentTarget.value);
          }}
        />
      </Field>
      <div class="row">
        <Button type="submit" variant="primary">
          Save
        </Button>
      </div>
    </form>
  );
}
