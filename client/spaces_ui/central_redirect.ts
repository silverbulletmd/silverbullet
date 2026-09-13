export async function redirectToCentral(destination: string): Promise<boolean> {
  if (globalThis.isSecureContext === false) return false;
  const response = await fetch("/.auth/central/public");
  if (!response.ok) return false;
  const config = await response.json();
  if (!config.configured) return false;
  const target = new URL(destination, location.origin);
  if (target.origin !== location.origin) return false;
  const start = new URL("/.auth/central/start", location.origin);
  start.searchParams.set("destination", target.href);
  start.searchParams.set(
    "encrypt",
    String(!!localStorage.getItem("enableEncryption")),
  );
  location.replace(start.href);
  return true;
}
