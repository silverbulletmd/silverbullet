import { render } from "preact";
import { AuthHeader } from "./components/AuthHeader.tsx";
import { Wizard } from "./components/Wizard.tsx";

render(
  <>
    <AuthHeader logo="assets/logo-dock-96x96.png" />
    <div class="sb-auth-content sb-setup-content">
      <Wizard />
    </div>
  </>,
  document.getElementById("root")!,
);
