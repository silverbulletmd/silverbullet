import { listEvents } from "$sb/plugos-syscall/event.ts";
import { matchBefore } from "$sb/silverbullet-syscall/editor.ts";

export async function queryComplete() {
  let prefix = await matchBefore("#query [\\w\\-_]*");

  if (prefix) {
    let allEvents = await listEvents();
    //   console.log("All events", allEvents);

    return {
      from: prefix.from + "#query ".length,
      options: allEvents
        .filter((eventName) => eventName.startsWith("query:"))
        .map((source) => ({
          label: source.substring("query:".length),
        })),
    };
  }
}
