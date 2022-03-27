#!/usr/bin/env node

import express from "express";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { DiskPlugLoader } from "../plug_loader";
import { CronHook, NodeCronFeature } from "../feature/node_cron";
import shellSyscalls from "../syscall/shell.node";
import { System } from "../system";
import { EndpointFeature, EndpointHook } from "../feature/endpoint";
import { safeRun } from "../util";
import knex from "knex";
import {
  ensureTable,
  storeReadSyscalls,
  storeWriteSyscalls,
} from "../syscall/store.knex_node";
import { fetchSyscalls } from "../syscall/fetch.node";
import { EventFeature, EventHook } from "../feature/event";
import { eventSyscalls } from "../syscall/event";

let args = yargs(hideBin(process.argv))
  .option("port", {
    type: "number",
    default: 1337,
  })
  .parse();

if (!args._.length) {
  console.error("Usage: plugbox-server <path-to-plugs>");
  process.exit(1);
}

const plugPath = args._[0] as string;

const app = express();

type ServerHook = EndpointHook & CronHook & EventHook;
const system = new System<ServerHook>("server");

safeRun(async () => {
  const db = knex({
    client: "better-sqlite3",
    connection: {
      filename: "plugbox.db",
    },
    useNullAsDefault: true,
  });

  await ensureTable(db, "item");

  let plugLoader = new DiskPlugLoader(system, plugPath);
  await plugLoader.loadPlugs();
  plugLoader.watcher();
  system.addFeature(new NodeCronFeature());
  let eventFeature = new EventFeature();
  system.addFeature(eventFeature);
  system.registerSyscalls("event", [], eventSyscalls(eventFeature));
  system.addFeature(new EndpointFeature(app, ""));
  system.registerSyscalls("shell", [], shellSyscalls("."));
  system.registerSyscalls("fetch", [], fetchSyscalls());
  system.registerSyscalls(
    "store",
    [],
    storeWriteSyscalls(db, "item"),
    storeReadSyscalls(db, "item")
  );
  app.listen(args.port, () => {
    console.log(`Plugbox server listening on port ${args.port}`);
  });
});
