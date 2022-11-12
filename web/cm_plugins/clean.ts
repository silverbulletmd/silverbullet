import type { Extension } from "../deps.ts";
import { blockQuotePlugin } from "./block_quote.ts";
import { directivePlugin } from "./directive.ts";
import { hideHeaderMarkPlugin, hideMarks } from "./hide_mark.ts";
import { hideImageNodePlugin } from "./image.ts";
import { goToLinkPlugin } from "./link.ts";
import { listBulletPlugin } from "./list.ts";
import { taskListPlugin } from "./task.ts";
import { cleanWikiLinkPlugin } from "./wiki_link.ts";

export const cleanModePlugs = [
  goToLinkPlugin,
  directivePlugin,
  blockQuotePlugin,
  hideMarks(),
  hideHeaderMarkPlugin,
  hideImageNodePlugin,
  taskListPlugin,
  listBulletPlugin,
  cleanWikiLinkPlugin(),
] as Extension[];
