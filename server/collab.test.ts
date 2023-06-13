import { assert, assertEquals } from "../test_deps.ts";
import { CollabServer } from "./collab.ts";

Deno.test("Collab server", async () => {
  const collabServer = new CollabServer(null as any);
  console.log("Client 1 joins page 1");
  assertEquals(collabServer.updatePresence("client1", "page1"), {});
  assertEquals(collabServer.pages.size, 1);
  console.log("CLient 1 leaves page 1");
  assertEquals(collabServer.updatePresence("client1", undefined, "page1"), {});
  assertEquals(collabServer.pages.size, 0);
  assertEquals(collabServer.updatePresence("client1", "page1"), {});
  console.log("Client 1 joins page 2");
  assertEquals(collabServer.updatePresence("client1", "page2", "page1"), {});
  assertEquals(collabServer.pages.size, 1);
  console.log("Client 2 joins to page 2, collab id created, but not exposed");
  assertEquals(
    collabServer.updatePresence("client2", "page2").collabId,
    undefined,
  );
  assert(
    collabServer.updatePresence("client1", "page2").collabId !== undefined,
  );
  console.log("Client 2 moves to page 1, collab id destroyed");
  assertEquals(collabServer.updatePresence("client2", "page1", "page2"), {});
  assertEquals(collabServer.updatePresence("client1", "page2", "page2"), {});
  assertEquals(collabServer.pages.get("page2")!.collabId, undefined);
  assertEquals(collabServer.pages.get("page1")!.collabId, undefined);
  console.log("Going to cleanup, which should have no effect");
  collabServer.cleanup(50);
  assertEquals(collabServer.pages.size, 2);
  collabServer.updatePresence("client2", "page2", "page1");
  console.log("Going to sleep 20ms");
  await sleep(20);
  console.log("Then client 1 pings, but client 2 does not");
  collabServer.updatePresence("client1", "page2", "page2");
  await sleep(20);
  console.log("Going to cleanup, which should clean client 2");
  collabServer.cleanup(35);
  assertEquals(collabServer.pages.get("page2")!.collabId, undefined);
  console.log(collabServer);
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
