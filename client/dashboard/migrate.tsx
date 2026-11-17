import { render } from "preact";
import { AuthHeader } from "./components/AuthHeader.tsx";
import { MigrateFlow } from "./components/migrate/MigrateFlow.tsx";

render(
  <>
    <AuthHeader logo="assets/logo-dock-96x96.png" />
    <div class="sb-auth-content sb-setup-content">
      <MigrateFlow />
    </div>
  </>,
  document.getElementById("root")!,
);
