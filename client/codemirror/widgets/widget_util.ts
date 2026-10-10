import { type Path, parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  resolveTransclusionUrl,
  type Transclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";
import { identityId } from "../../../plugs/index/identity_id.ts";
import type { Client } from "../../client.ts";

/**
 * Gives widget renderers the same wiki-link resolution the editor's own link
 * renderer uses, so an `![[embed]]` inside a rendered widget finds its file
 * the way a `[[link]]` would.
 */
export function buildResolveTransclusion(
  client: Client,
): (t: Transclusion, fromPage?: string) => void {
  return (t, fromPage) =>
    resolveTransclusionUrl(
      t,
      (fromPage ? `${fromPage}.md` : client.currentPath()) as Path,
      client.clientSystem.allKnownFiles,
    );
}

export function buildTranslateUrls(client: Client): (url: string) => string {
  return (url: string) => {
    if (isLocalURL(url)) {
      return resolveMarkdownLink(client.currentName(), decodeURI(url));
    }
    return url;
  };
}

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
): void {
  // Delegated from `div` rather than bound to each link, button and task:
  // rendered content can be a cached element that outlives this widget, and
  // listeners on it would keep the widget alive and pile up on every remount.
  if (!div.dataset.handlersAttached) {
    div.dataset.handlersAttached = "true";
    const within = (e: Event, selector: string): HTMLElement | null => {
      const el =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>(selector)
          : null;
      return el && div.contains(el) ? el : null;
    };

    div.addEventListener("mousedown", (e) => {
      if (e.altKey && widgetText) {
        moveCursorToWidgetStart(client, div, widgetText);
        e.preventDefault();
      } else if (
        !e.altKey &&
        within(
          e,
          "span[data-external-task-ref] span.sb-task-state[data-task-state]",
        )
      ) {
        // Keep CodeMirror from moving the selection to the widget source
        e.preventDefault();
      }
      // Prevent CodeMirror's parent handler from moving the selection.
      e.stopPropagation();
    });

    div.addEventListener("mouseup", (e) => {
      e.stopPropagation();
    });

    div.addEventListener("click", (e) => {
      // Ctrl/meta-click navigates in a new window: we can't rely on the
      // browser's native "open in new tab" for the anchor's href, because
      // inside the desktop app's webview that just navigates in place.
      const link = within(e, "a[data-ref]");
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        void client.navigate(
          parseToRef(link.dataset.ref!),
          false,
          e.ctrlKey || e.metaKey,
        );
        return;
      }

      // Like a mention in the editor: open the Mention Inbox on that
      // recipient, leaving focus where it is.
      const mention = within(e, "[data-mention-name]");
      if (mention) {
        e.preventDefault();
        e.stopPropagation();
        void client.openNavigatorView("inbox", {
          dropdown: identityId(mention.dataset.mentionName!),
          focus: false,
        });
        return;
      }

      const button = within(e, "button[data-onclick]");
      if (button) {
        const parsedOnclick = JSON.parse(button.dataset.onclick!);
        if (parsedOnclick[0] === "command") {
          e.preventDefault();
          e.stopPropagation();
          console.info(
            "Command link clicked in widget, running",
            parsedOnclick,
          );
          client
            .runCommandByName(parsedOnclick[1], parsedOnclick[2])
            .catch(console.error);
        }
        return;
      }

      const task = within(e, "span[data-external-task-ref]");
      if (!task) return;
      if (within(e, "input[type=checkbox]")) {
        e.stopPropagation();
        return;
      }
      const taskStateSpan = within(e, "span.sb-task-state[data-task-state]");
      // Alt+Click is for cursor positioning
      if (!taskStateSpan || e.altKey) return;
      e.stopPropagation();
      const taskRef = task.dataset.externalTaskRef;
      const oldState = taskStateSpan.dataset.taskState;
      console.log("Cycling extended task", taskRef, oldState);
      client.clientSystem
        .localSyscall("system.invokeFunction", [
          "index.cycleTaskStateByRef",
          taskRef,
          oldState,
        ])
        .then((newState: string) => {
          taskStateSpan.dataset.taskState = newState;
          taskStateSpan.textContent = newState;
        })
        .catch(console.error);
    });

    div.addEventListener("change", (e) => {
      const task = within(e, "span[data-external-task-ref]");
      const input = within(e, "input[type=checkbox]");
      if (!task || !input) return;
      e.stopPropagation();
      const taskRef = task.dataset.externalTaskRef;
      const oldState = input.dataset.state;
      const newState = oldState === " " ? "x" : " ";
      input.dataset.state = newState;
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

  div
    .querySelectorAll<HTMLElement>(
      "span[data-external-task-ref] span.sb-task-state[data-task-state]",
    )
    .forEach((el) => {
      el.style.cursor = "pointer";
    });

  div.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    if (!cb.closest("span[data-external-task-ref]")) {
      cb.setAttribute("disabled", "disabled");
    }
  });
}
