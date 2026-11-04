import { useEffect, useState } from "preact/hooks";
import { publicConfig } from "./public_config.ts";

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
    void publicConfig().then((config) => {
      if (typeof config?.serverName === "string" && config.serverName)
        updateServerName(config.serverName);
    });
    return () => window.removeEventListener(nameChanged, changed);
  }, []);
  return name;
}
