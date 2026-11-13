import { render } from "preact";
import { App } from "./components/App.tsx";
import { NotificationProvider } from "./notifications.tsx";

// Old links used `section=runtimes`; keep the address bar in step with the tab.
const legacy = new URLSearchParams(location.search);
if (legacy.get("section") === "runtimes") {
  legacy.set("section", "apis");
  history.replaceState(
    history.state,
    "",
    `${location.pathname}?${legacy}${location.hash}`,
  );
}

render(
  <NotificationProvider>
    <App />
  </NotificationProvider>,
  document.getElementById("root")!,
);
