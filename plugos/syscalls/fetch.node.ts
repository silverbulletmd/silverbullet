import fetch, {RequestInfo, RequestInit} from "node-fetch";
import {SysCallMapping} from "../system";

export function fetchSyscalls(): SysCallMapping {
  return {
    "fetch.json": async (ctx, url: RequestInfo, init: RequestInit) => {
      let resp = await fetch(url, init);
      return resp.json();
    },
    "fetch.text": async(ctx, url: RequestInfo, init: RequestInit) => {
      let resp = await fetch(url, init);
      return resp.text();
    },
  };
}
