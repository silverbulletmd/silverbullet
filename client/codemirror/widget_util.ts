import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import type { Client } from "../client.ts";
import type { EventPayLoad } from "./lua_widget.ts";

export function moveCursorToWidgetStart(
  client: Client,
  widgetDom: HTMLElement,
  widgetText?: string,
) {
  const view = client.editorView;
  const pos = view.posAtDOM(widgetDom, 0);

  let anchor = pos;
  if (widgetText) {
    // The widget decoration may be placed at the end of the source range
    // (node.to). Search near posAtDOM for the actual text to find its start.
    const searchFrom = Math.max(0, pos - widgetText.length);
    const region = view.state.sliceDoc(searchFrom, pos + widgetText.length);
    const idx = region.lastIndexOf(widgetText);
    if (idx !== -1) {
      anchor = searchFrom + idx;
    }
  }

  view.dispatch({ selection: { anchor } });
  client.focus();
}

export function attachWidgetEventHandlers(
  div: HTMLElement,
  client: Client,
  widgetText?: string,
  events?: Record<string, (event: EventPayLoad) => void>,
) {
  if (!div.dataset.handlersAttached) {
    div.dataset.handlersAttached = "true";
    div.addEventListener("mousedown", (e) => {
      if (e.altKey && widgetText) {
        // Move cursor there
        moveCursorToWidgetStart(client, div, widgetText);
        e.preventDefault();
      }
      // CodeMirror overrides mousedown on parent elements to implement its own selection highlighting.
      // That's nice, but not for markdown widgets, so let's not propagate the event to CodeMirror here.
      e.stopPropagation();
    });

    div.addEventListener("mouseup", (e) => {
      // Same as above
      e.stopPropagation();
    });
  }

  // Override wiki links with local navigate (faster)
  div.querySelectorAll("a[data-ref]").forEach((el_) => {
    const el = el_ as HTMLElement;
    // Override default click behavior with a local navigate (faster)
    el.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Don't do anything special for ctrl/meta clicks
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void client.navigate(
        parseToRef(el.dataset.ref!),
        false,
        e.ctrlKey || e.metaKey,
      );
    });
  });

  div.querySelectorAll("button[data-onclick]").forEach((el_) => {
    const el = el_ as HTMLElement;
    const onclick = el.dataset.onclick!;
    const parsedOnclick = JSON.parse(onclick);
    if (parsedOnclick[0] === "command") {
      const command = parsedOnclick[1];
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.info("Command link clicked in widget, running", parsedOnclick);
        client.runCommandByName(command, parsedOnclick[2]).catch(console.error);
      });
    }
  });

  // Implement task toggling
  div.querySelectorAll("span[data-external-task-ref]").forEach((el: any) => {
    const taskRef = el.dataset.externalTaskRef;
    const input = el.querySelector("input[type=checkbox]");
    if (input) {
      input.addEventListener("click", (e: any) => {
        // Avoid triggering the click on the parent
        e.stopPropagation();
      });
      input.addEventListener("change", (e: any) => {
        e.stopPropagation();
        const oldState = e.target.dataset.state;
        const newState = oldState === " " ? "x" : " ";
        // Update state in DOM as well for future toggles
        e.target.dataset.state = newState;
        console.log("Toggling task", taskRef);
        client.clientSystem
          .localSyscall("system.invokeFunction", [
            "index.updateTaskState",
            taskRef,
            oldState,
            newState,
          ])
          .catch(console.error);
      });
    }

    // Extended task states (e.g. [PLANNED], [TODO])
    const taskStateSpan = el.querySelector("span.sb-task-state[data-state]");
    if (taskStateSpan) {
      taskStateSpan.style.cursor = "pointer";
      taskStateSpan.addEventListener("mousedown", (e: any) => {
        if (e.altKey) {
          // Pass to the mouse down handler for Alt+Click cursor move
          return;
        }
        // Prevent CodeMirror from moving selection to widget source
        e.preventDefault();
        e.stopPropagation();
      });
      taskStateSpan.addEventListener("click", (e: any) => {
        if (e.altKey) {
          // Alt+Click is for cursor positioning
          return;
        }
        e.stopPropagation();
        const oldState = taskStateSpan.dataset.state;
        console.log("Cycling extended task", taskRef, oldState);
        client.clientSystem
          .localSyscall("system.invokeFunction", [
            "index.cycleTaskStateByRef",
            taskRef,
            oldState,
          ])
          .then((newState: string) => {
            taskStateSpan.dataset.state = newState;
            taskStateSpan.textContent = newState;
          })
          .catch(console.error);
      });
    }
  });

  // Disable non-referenced task checkboxes
  div.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    if (!cb.closest("span[data-external-task-ref]")) {
      cb.setAttribute("disabled", "disabled");
    }
  });

  if (events) {
    for (const [eventName, event] of Object.entries(events)) {
      div.addEventListener(eventName, (e) => {
        event({ name: eventName, data: e });
      });
    }
  }
}
