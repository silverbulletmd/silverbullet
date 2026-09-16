import { useEffect, useState } from "preact/hooks";

const nameChanged = "sb-server-name-changed";
let currentName = "SilverBullet";

export function updateServerName(name: string): void {
  currentName = name;
  window.dispatchEvent(new Event(nameChanged));
}

export function useServerName(): string {
  const [name, setName] = useState(currentName);
  useEffect(() => {
    const changed = () => setName(currentName);
    window.addEventListener(nameChanged, changed);
    const controller = new AbortController();
    void fetch("/.auth/central/public", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const config = await response.json();
        if (typeof config.serverName === "string" && config.serverName)
          updateServerName(config.serverName);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      window.removeEventListener(nameChanged, changed);
    };
  }, []);
  return name;
}
