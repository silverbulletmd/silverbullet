import type { Config } from "./config.ts";
import type { EventHook } from "./plugos/hooks/event.ts";

export type ServiceMatch = {
  id?: string; // uuid, set automatically
  priority?: number;
} & Record<string, any>;

export type ServiceSpec = {
  selector: string;
  match:
    | ServiceMatch
    | ((data: any) => Promise<ServiceMatch | null | undefined>);
  run: (data: any) => Promise<any>;
};

export class ServiceRegistry {
  constructor(private eventHook: EventHook, private config: Config) {
  }

  public define(spec: ServiceSpec): void {
    const id = crypto.randomUUID();
    // Register with discover:* event
    this.config.insert([
      "eventListeners",
      `discover:${spec.selector}`,
    ], async (e: any) => {
      const matchResult = typeof spec.match === "function"
        ? await spec.match(e.data)
        : spec.match;
      if (matchResult) {
        return {
          ...matchResult,
          id,
        };
      }
    });
    // Register callback when invoked
    this.config.insert(["eventListeners", `service:${id}`], (e: any) => {
      return spec.run(e.data);
    });
  }

  public async discover(selector: string, opts: any): Promise<ServiceMatch[]> {
    const discoveryResults: ServiceMatch[] = await this.eventHook.dispatchEvent(
      `discover:${selector}`,
      opts,
    );
    discoveryResults.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return discoveryResults;
  }

  public async invoke(match: ServiceMatch, data: any): Promise<any> {
    const results = await this.eventHook.dispatchEvent(
      `service:${match.id}`,
      data,
    );
    // Note: results may be an empty array in case no service actually returned a result (void) case, which is implicitly passed on here
    return results[0];
  }

  public async invokeBestMatch(selector: string, data: any): Promise<any> {
    const results = await this.discover(selector, data);
    if (results.length === 0) {
      throw new Error(`No services matching: ${selector}`);
    }
    return this.invoke(results[0], data);
  }
}
