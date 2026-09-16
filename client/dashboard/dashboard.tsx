import { render } from "preact";
import { App } from "./components/App.tsx";

import { NotificationProvider } from "./notifications.tsx";

render(
  <NotificationProvider>
    <App />
  </NotificationProvider>,
  document.getElementById("root")!,
);
