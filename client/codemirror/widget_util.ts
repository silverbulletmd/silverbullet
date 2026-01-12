import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import type { Client } from "../client.ts";
import type { EventPayLoad } from "./lua_widget.ts";

export function moveCursorIntoText(client: Client, textToFind: string) {
  const allText = client.editorView.state.sliceDoc();
  const pos = allText.indexOf(textToFind);
  if (pos === -1) {
    console.error("Could not find position of widget in text", textToFind);
    return;
  }
  client.editorView.dispatch({
    selection: {
      anchor: pos,
    },
  });
  client.focus();
}

export function attachWidgetEventHandlers(
  div: HTMLElement,
  client: Client,
  widgetText?: string,
  events?: Record<string, (event: EventPayLoad) => void>,
) {
  div.addEventListener("mousedown", (e) => {
    if (e.altKey && widgetText) {
      // Move cursor there
      moveCursorIntoText(client, widgetText);
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
      client.navigate(
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
        console.info(
          "Command link clicked in widget, running",
          parsedOnclick,
        );
        client.runCommandByName(command, parsedOnclick[2]).catch(
          console.error,
        );
      });
    }
  });

  // Implement task toggling
  div.querySelectorAll("span[data-external-task-ref]").forEach((el: any) => {
    const taskRef = el.dataset.externalTaskRef;
    const input = el.querySelector("input[type=checkbox]");
    if (input) {
      input.addEventListener(
        "click",
        (e: any) => {
          // Avoid triggering the click on the parent
          e.stopPropagation();
        },
      );
      input.addEventListener(
        "change",
        (e: any) => {
          e.stopPropagation();
          const oldState = e.target.dataset.state;
          const newState = oldState === " " ? "x" : " ";
          // Update state in DOM as well for future toggles
          e.target.dataset.state = newState;
          console.log("Toggling task", taskRef);
          client.clientSystem.localSyscall(
            "system.invokeFunction",
            ["index.updateTaskState", taskRef, oldState, newState],
          ).catch(
            console.error,
          );
        },
      );
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
