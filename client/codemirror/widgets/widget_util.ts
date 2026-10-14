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

// Task changes from widgets are saved one at a time, in click order. Each one
// reads its row's ref and state when its turn comes, so it starts from what
// the saves before it left behind.
let taskSaves: Promise<void> = Promise.resolve();

function queueTaskSave(save: () => Promise<void>): void {
  taskSaves = taskSaves.then(save).catch(console.error);
}

function flashStaleTask(client: Client): void {
  client.ui.flashNotification(
    "This task changed since the list was rendered, so it was left as it is",
    "error",
  );
}

const positionRef = /^(.+)@(\d+)$/;

/**
 * A task ref records where the task's list item starts, so a state whose text
 * changes length moves every later task on the same page. Moves the rendered
 * refs of those tasks to match.
 */
function shiftTaskRefsAfter(ref: string, delta: number): void {
  const changed = positionRef.exec(ref);
  if (!changed || delta === 0) return;
  const [, page, pos] = changed;
  document
    .querySelectorAll<HTMLElement>("span[data-external-task-ref]")
    .forEach((el) => {
      const other = positionRef.exec(el.dataset.externalTaskRef!);
      if (other && other[1] === page && Number(other[2]) > Number(pos)) {
        el.dataset.externalTaskRef = `${page}@${Number(other[2]) + delta}`;
      }
    });
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

    // Nested views and widgets stop bubbling mouse events. Claim source
    // editing before their handlers can swallow Alt-click or activate a link.
    if (widgetText) {
      div.addEventListener(
        "mousedown",
        (e) => {
          if (!e.altKey) return;
          e.preventDefault();
          e.stopPropagation();
          moveCursorToWidgetStart(client, div, widgetText);
        },
        true,
      );
      div.addEventListener(
        "click",
        (e) => {
          if (!e.altKey) return;
          e.preventDefault();
          e.stopPropagation();
        },
        true,
      );
    }

    div.addEventListener("mousedown", (e) => {
      if (
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
      queueTaskSave(async () => {
        const taskRef = task.dataset.externalTaskRef!;
        const oldState = taskStateSpan.dataset.taskState!;
        console.log("Cycling extended task", taskRef, oldState);
        const newState: string | undefined =
          await client.clientSystem.localSyscall("system.invokeFunction", [
            "index.cycleTaskStateByRef",
            taskRef,
            oldState,
          ]);
        if (typeof newState !== "string") {
          flashStaleTask(client);
          return;
        }
        taskStateSpan.dataset.taskState = newState;
        taskStateSpan.textContent = newState;
        shiftTaskRefsAfter(taskRef, newState.length - oldState.length);
      });
    });

    div.addEventListener("change", (e) => {
      const task = within(e, "span[data-external-task-ref]");
      const input = within(e, "input[type=checkbox]");
      if (!task || !(input instanceof HTMLInputElement)) return;
      e.stopPropagation();
      queueTaskSave(async () => {
        const taskRef = task.dataset.externalTaskRef!;
        const oldState = input.dataset.state!;
        const newState = oldState === " " ? "x" : " ";
        console.log("Toggling task", taskRef);
        const saved = await client.clientSystem.localSyscall(
          "system.invokeFunction",
          ["index.updateTaskState", taskRef, oldState, newState],
        );
        if (!saved) {
          input.checked = oldState !== " ";
          flashStaleTask(client);
          return;
        }
        input.dataset.state = newState;
      });
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
