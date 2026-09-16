import { canCleanUpLogout } from "../../logout_state.ts";
import { deleteLocalSpaceData } from "../../logout_cleanup.ts";
import { useEffect, useState } from "preact/hooks";
import { Alert, Button } from "@silverbulletmd/silverbullet/ui";

export function SignedOut({
  onContinue,
  requireRevocation = false,
}: {
  onContinue: () => void;
  requireRevocation?: boolean;
}) {
  const [authorized] = useState(() => !requireRevocation || canCleanUpLogout());
  const [cleanup, setCleanup] = useState<"busy" | "done" | "failed">("busy");
  const [cleanupError, setCleanupError] = useState("");
  async function cleanUp() {
    setCleanup("busy");
    try {
      const registrations =
        (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(
        registrations
          .filter((registration) =>
            [
              registration.active,
              registration.waiting,
              registration.installing,
            ].some(
              (worker) =>
                worker &&
                new URL(worker.scriptURL).pathname.endsWith(
                  "/service_worker.js",
                ),
            ),
          )
          .map((registration) => registration.unregister()),
      );
      await deleteLocalSpaceData();
      setCleanup("done");
    } catch (error) {
      setCleanupError(
        error instanceof Error
          ? error.message
          : "Could not remove all local data.",
      );
      setCleanup("failed");
    }
  }
  useEffect(() => {
    if (authorized) void cleanUp();
  }, []);
  if (!authorized)
    return (
      <>
        <h1>Sign in</h1>
        <p>No logout is pending.</p>
        <Button onClick={onContinue}>Sign in</Button>
      </>
    );
  return (
    <>
      <h1>You are signed out</h1>
      {cleanup === "busy" && <p role="status">Removing local data…</p>}
      {cleanup === "done" && (
        <p>Local space data has been removed from this browser.</p>
      )}
      {cleanup === "failed" && (
        <>
          <Alert variant="warning">{cleanupError}</Alert>
          <Button onClick={() => void cleanUp()}>Retry cleanup</Button>
        </>
      )}
      <Button
        variant="primary"
        disabled={cleanup !== "done"}
        onClick={onContinue}
      >
        Sign in
      </Button>
    </>
  );
}
