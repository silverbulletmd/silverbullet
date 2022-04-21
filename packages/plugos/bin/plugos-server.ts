#!/usr/bin/env node

import express from "express";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { DiskPlugLoader } from "../plug_loader";
import { CronHookT, NodeCronHook } from "../hooks/node_cron";
import shellSyscalls from "../syscalls/shell.node";
import { System } from "../system";
import { EndpointHook, EndpointHookT } from "../hooks/endpoint";
import { safeRun } from "../util";
import knex from "knex";
import { ensureTable, storeSyscalls } from "../syscalls/store.knex_node";
import { fetchSyscalls } from "../syscalls/fetch.node";
import { EventHook, EventHookT } from "../hooks/event";
import { eventSyscalls } from "../syscalls/event";

let args = yargs(hideBin(process.argv))
  .option("port", {
    type: "number",
    default: 1337,
  })
  .parse();

if (!args._.length) {
  console.error("Usage: plugos-server <path-to-plugs>");
  process.exit(1);
}

const plugPath = args._[0] as string;

const app = express();

type ServerHook = EndpointHookT & CronHookT & EventHookT;
const system = new System<ServerHook>("server");

safeRun(async () => {
  const db = knex({
    client: "better-sqlite3",
    connection: {
      filename: "plugos.db",
    },
    useNullAsDefault: true,
  });

  await ensureTable(db, "item");

  let plugLoader = new DiskPlugLoader(system, plugPath);
  await plugLoader.loadPlugs();
  plugLoader.watcher();
  system.addHook(new NodeCronHook());
  let eventHook = new EventHook();
  system.addHook(eventHook);
  system.registerSyscalls([], eventSyscalls(eventHook));
  system.addHook(new EndpointHook(app, ""));
  system.registerSyscalls([], shellSyscalls("."));
  system.registerSyscalls([], fetchSyscalls());
  system.registerSyscalls([], storeSyscalls(db, "item"));
  app.listen(args.port, () => {
    console.log(`Plugbox server listening on port ${args.port}`);
  });
});
