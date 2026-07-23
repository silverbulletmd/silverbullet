import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";

/** How long to wait for the hot-swap before assuming the server won't come up. */
const MAX_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 1000;

/**
 * Final step of the setup wizard: poll `target` until the server has
 * hot-swapped into the live multi-space stack, then navigate there. Owns the
 * polling because it only runs while this step is on screen — mounting is the
 * start signal, unmounting the stop signal.
 */
export function DoneStep({ target }: { target: string }) {
  const [pollExhausted, setPollExhausted] = useState(false);

  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      attempts++;
      try {
        // `redirect: "manual"` is essential here: the pre-swap server still
        // answers with a 307 to `/.setup/` for every other path, and a
        // follow-the-redirect fetch would see that target's 200 and think
        // the hot-swap already happened. An opaque redirect (or status 0)
        // means we're still talking to the old server — keep polling.
        const r = await fetch(target, {
          cache: "no-store",
          redirect: "manual",
        });
        const notReady =
          r.status === 404 ||
          r.status === 503 ||
          r.type === "opaqueredirect" ||
          r.status === 0;
        if (!notReady) {
          location.href = target;
          return;
        }
      } catch {
        // Server mid-swap (port briefly unreachable) — keep polling.
      }
      if (stopped) return;
      if (attempts >= MAX_ATTEMPTS) {
        setPollExhausted(true);
        return;
      }
      timer = setTimeout(check, POLL_INTERVAL_MS);
    };
    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [target]);

  return (
    <Fragment>
      <h1>Setup complete</h1>
      {pollExhausted ? (
        <p>
          The server is taking longer than expected — it may have failed to
          start. Check the server logs, then reload this page.{" "}
          <a href={target}>{target}</a>
        </p>
      ) : (
        <p>Setup complete — taking you to your space…</p>
      )}
    </Fragment>
  );
}
