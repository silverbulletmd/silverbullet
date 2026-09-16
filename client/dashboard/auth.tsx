import { render } from "preact";
import { type AuthConfig, SpaceLogin } from "./components/SpaceLogin.tsx";

/**
 * Read the server-templated config off `#root`'s data attributes. Attributes
 * rather than a JSON island because the shell is autoescaped and a
 * user-controlled space name has to survive that intact — see auth.html.
 */
export function readAuthConfig(root: HTMLElement): AuthConfig {
  return {
    spaceName: root.dataset.spaceName ?? "",
    encryptionSalt: root.dataset.encryptionSalt ?? "",
    rememberMeDays: Number(root.dataset.rememberMeDays ?? 0),
    accountManaged: root.dataset.accountManaged === "true",
  };
}

const root = document.getElementById("root")!;
render(<SpaceLogin config={readAuthConfig(root)} />, root);
