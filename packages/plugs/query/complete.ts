import { listEvents } from "@plugos/plugos-syscall/event";
import { matchBefore } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { listPages } from "@silverbulletmd/plugos-silverbullet-syscall/space";

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

  prefix = await matchBefore('render "[^"]*');
  if (prefix) {
    let allPages = await listPages();
    return {
      from: prefix.from + 'render "'.length,
      options: allPages.map((pageMeta) => ({
        label: pageMeta.name,
      })),
    };
  }

  prefix = await matchBefore('#inst "[^"]*');
  if (prefix) {
    let allPages = await listPages();
    return {
      from: prefix.from + '#inst "'.length,
      options: allPages.map((pageMeta) => ({
        label: pageMeta.name,
      })),
    };
  }
}
