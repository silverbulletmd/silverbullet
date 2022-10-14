import { events } from "$sb/plugos-syscall/mod.ts";
import { editor } from "$sb/silverbullet-syscall/mod.ts";

export async function queryComplete() {
  const prefix = await editor.matchBefore("#query [\\w\\-_]*");

  if (prefix) {
    const allEvents = await events.listEvents();
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
