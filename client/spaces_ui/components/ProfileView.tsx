import { useEffect, useState } from "preact/hooks";
import { Alert, Button, Input } from "@silverbulletmd/silverbullet/ui";
import { formatApiError, getProfile, setProfile } from "../api.ts";
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
  const [saved, setSaved] = useState(false);

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
    try {
      await action();
      setError("");
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
      else setError(formatApiError(error));
    }
  }

  if (!loaded) return <p>Loading…</p>;
  if (!profile)
    return <Alert variant="error">{error || "Profile not found"}</Alert>;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await setProfile(fullName, email);
          setSaved(true);
        });
      }}
    >
      {error && <Alert variant="error">{error}</Alert>}
      <p class="sb-help-text">
        Used for revision history and collaboration features.
      </p>

      <label for="profile-full-name">Full name</label>
      <Input
        id="profile-full-name"
        value={fullName}
        onInput={(event) => {
          setFullName(event.currentTarget.value);
          setSaved(false);
        }}
      />
      <label for="profile-email">Email</label>
      <Input
        id="profile-email"
        value={email}
        onInput={(event) => {
          setEmail(event.currentTarget.value);
          setSaved(false);
        }}
      />
      <div class="row">
        <Button type="submit" variant="primary">
          Save
        </Button>
        {saved && <span class="sb-help-text">Saved.</span>}
      </div>
    </form>
  );
}
