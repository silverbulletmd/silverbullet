/**
 * After a "Shared computer" sign-in: unregister the service worker the login
 * page installed for this space, so nothing keeps running or caching on the
 * device. Other spaces' workers belong to other sessions and stay.
 *
 * Never throws and never waits longer than `timeoutMs`: login must still
 * redirect. A worker left behind is removed by the editor's boot, which sees
 * `disableServiceWorker` in this session's config.
 */
export async function forgetServiceWorker(
  scope: string,
  serviceWorker: ServiceWorkerContainer | undefined = navigator.serviceWorker,
  timeoutMs = 2000,
): Promise<void> {
  if (!serviceWorker) return;
  const forget = (async () => {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => registration.scope === scope)
        .map((registration) => registration.unregister()),
    );
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn("Service worker did not unregister in time, continuing");
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([forget, giveUp]);
  } catch (e) {
    console.error("Could not remove service worker", e);
  } finally {
    clearTimeout(timer);
  }
}
