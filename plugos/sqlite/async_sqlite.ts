// import { AssetBundle } from "../asset_bundle/bundle.ts";
import { ISQLite } from "./sqlite_interface.ts";
// import workerBundleJson from "./worker_bundle.json" assert { type: "json" };

// const workerBundle = new AssetBundle(workerBundleJson);

export class AsyncSQLite implements ISQLite {
  worker: Worker;
  requestId = 0;
  outstandingRequests = new Map<
    number,
    { resolve: (val: any) => void; reject: (error: Error) => void }
  >();

  constructor(readonly dbPath: string) {
    // const workerHref = URL.createObjectURL(
    //   new Blob([
    //     workerBundle.readFileSync("worker.js"),
    //   ], {
    //     type: "application/javascript",
    //   }),
    // );
    this.worker = new Worker(
      new URL("./worker.ts", import.meta.url),
      // import.meta.resolve("./worker.ts"),
      // workerHref,
      {
        type: "module",
      },
    );
    this.worker.addEventListener("message", (event: MessageEvent) => {
      const { data } = event;
      // console.log("Got data back", data);
      const { id, result, error } = data;
      const req = this.outstandingRequests.get(id);
      if (!req) {
        console.error("Invalid request id", id);
        return;
      }
      if (result !== undefined) {
        req.resolve(result);
      } else if (error) {
        req.reject(new Error(error));
      }
      this.outstandingRequests.delete(id);
    });
  }

  private request(message: Record<string, any>): Promise<any> {
    this.requestId++;
    return new Promise((resolve, reject) => {
      this.outstandingRequests.set(this.requestId, { resolve, reject });
      // console.log("Sending request", message);
      this.worker.postMessage({ ...message, id: this.requestId });
    });
  }

  init(): Promise<void> {
    return this.request({ type: "init", dbPath: this.dbPath });
  }

  execute(query: string, ...params: any[]): Promise<number> {
    return this.request({ type: "execute", query, params });
  }

  query(query: string, ...params: any[]): Promise<any[]> {
    return this.request({ type: "query", query, params });
  }

  stop() {
    this.worker.terminate();
  }
}
