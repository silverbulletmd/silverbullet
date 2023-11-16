async function init() {
  // Make edit button send the "blur" API call so that the MD code is visible
  document.getElementById("edit-button").addEventListener("click", () => {
    api({ type: "blur" });
  });
  document.getElementById("reload-button").addEventListener("click", () => {
    api({ type: "reload" });
  });
  document.getElementById("source-button").addEventListener("click", () => {
    document.getElementById("body-content").innerText = originalMarkdown;
  });

  document.querySelectorAll("a[data-ref]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      syscall("editor.navigate", el.dataset.ref);
    });
  });

  // Find all fenced code blocks and replace them with iframes (if a code widget is defined for them)
  const allWidgets = document.querySelectorAll("pre[data-lang]");
  for (const widget of allWidgets) {
    const lang = widget.getAttribute("data-lang");
    const body = widget.innerText;

    try {
      const result = await syscall("codeWidget.render", lang, body, pageName);
      const iframe = document.createElement("iframe");
      iframe.src = "about:blank";

      iframe.onload = () => {
        iframe.contentDocument.write(panelHtml);
        iframe.contentWindow.postMessage({
          type: "html",
          theme: document.getElementsByTagName("html")[0].getAttribute(
            "data-theme",
          ),
          ...result,
        }, "*");
      };
      widget.parentNode.replaceChild(iframe, widget);

      globalThis.addEventListener("message", (e) => {
        if (e.source !== iframe.contentWindow) {
          return;
        }
        const messageData = e.data;
        switch (messageData.type) {
          case "setHeight":
            iframe.height = messageData.height + "px";
            // Propagate height setting to parent
            updateHeight();
            break;
          case "syscall": {
            // Intercept syscall messages and send them to the parent
            const { id, name, args } = messageData;
            syscall(name, ...args).then((result) => {
              iframe.contentWindow.postMessage(
                { id, type: "syscall-response", result },
                "*",
              );
            }).catch((error) => {
              iframe.contentWindow.postMessage({
                id,
                type: "syscall-response",
                error,
              }, "*");
            });
            break;
          }
          default:
            // Bubble up any other messages to parent iframe
            window.parent.postMessage(messageData, "*");
        }
      });
    } catch (e) {
      if (e.message.includes("not found")) {
        // Not a code widget, ignore
      } else {
        console.error("Error rendering widget", e);
      }
    }
  }

  // Find all task toggles and propagate their state
  document.querySelectorAll("span[data-external-task-ref]").forEach((el) => {
    const taskRef = el.dataset.externalTaskRef;
    el.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
      const oldState = e.target.dataset.state;
      const newState = oldState === " " ? "x" : " ";
      // Update state in DOM as well for future toggles
      e.target.dataset.state = newState;
      console.log("Toggling task", taskRef);
      syscall(
        "system.invokeFunction",
        "tasks.updateTaskState",
        taskRef,
        oldState,
        newState,
      ).catch(
        console.error,
      );
    });
  });
}

init().catch(console.error);
