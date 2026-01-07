import { Config } from "../client/config.ts";
import { DataStore } from "../client/data/datastore.ts";
import { MemoryKvPrimitives } from "../client/data/memory_kv_primitives.ts";
import { DataStoreMQ } from "../client/data/mq.datastore.ts";
import { EventHook } from "../client/plugos/hooks/event.ts";
import {
  dataStoreReadSyscalls,
  dataStoreWriteSyscalls,
} from "../client/plugos/syscalls/datastore.ts";
import { eventSyscalls } from "../client/plugos/syscalls/event.ts";
import { indexSyscalls } from "../client/plugos/syscalls/index.ts";
import { jsonschemaSyscalls } from "../client/plugos/syscalls/jsonschema.ts";
import { languageSyscalls } from "../client/plugos/syscalls/language.ts";
import { luaSyscalls } from "../client/plugos/syscalls/lua.ts";
import { markdownSyscalls } from "../client/plugos/syscalls/markdown.ts";
import { mqSyscalls } from "../client/plugos/syscalls/mq.ts";
import {
  spaceReadSyscalls,
  spaceWriteSyscalls,
} from "../client/plugos/syscalls/space.ts";
import { systemSyscalls } from "../client/plugos/syscalls/system.ts";
import { System } from "../client/plugos/system.ts";
import { Space } from "../client/space.ts";
import { SpaceLuaEnvironment } from "../client/space_lua.ts";
import { DataStoreSpacePrimitives } from "../client/spaces/datastore_space_primitives.ts";
import { EventedSpacePrimitives } from "../client/spaces/evented_space_primitives.ts";

export function createMockSystem() {
  const system = new System<any>();
  const eventHook = new EventHook();
  system.addHook(eventHook);
  const kv = new MemoryKvPrimitives();
  const ds = new DataStore(kv);
  const spacePrimitives = new EventedSpacePrimitives(
    new DataStoreSpacePrimitives(kv),
    eventHook,
    ds,
  );

  const space = new Space(spacePrimitives, eventHook);
  const mq = new DataStoreMQ(ds, eventHook);
  const config = new Config();
  const clientMock: any = {
    space,
    config,
    eventedSpacePrimitives: spacePrimitives,
  };

  const clientSystemMock: any = {
    system: system,
    spaceLuaEnv: new SpaceLuaEnvironment(system),
  };
  clientMock.clientSystem = clientSystemMock;

  system.registerSyscalls(
    [],
    eventSyscalls(eventHook, clientMock),
    spaceReadSyscalls(clientMock),
    spaceWriteSyscalls(clientMock),
    markdownSyscalls(clientMock),
    languageSyscalls(),
    jsonschemaSyscalls(),
    indexSyscalls(clientMock),
    luaSyscalls(clientSystemMock),
    mqSyscalls(mq),
    dataStoreReadSyscalls(ds, clientSystemMock),
    dataStoreWriteSyscalls(ds),
    systemSyscalls(clientMock, false),
  );

  // @ts-ignore: global
  globalThis.syscall = (name: string, ...args: any): Promise<any> => {
    return system.localSyscall(name, args);
  };

  return {
    system,
    eventHook,
    config,
    kv,
    spacePrimitives,
    mq,
    ds,
    space,
  };
}
