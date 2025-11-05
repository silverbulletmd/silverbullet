import { Config } from "./config.ts";
import type { EventHook } from "./plugos/hooks/event.ts";

export type ServiceMatch = {
  priority?: number;
} & Record<string, any>;

export type ServiceSpec = {
  name: string;
  selector: string;
  match: (data: any) => Promise<ServiceMatch | null | undefined>;
  run: (data: any) => Promise<any>;
};

export class ServiceRegistry {
  private usedServiceNames = new Set<string>();
  constructor(private eventHook: EventHook, private config: Config) {
  }

  public define(spec: ServiceSpec): void {
    if (this.usedServiceNames.has(spec.name)) {
      throw new Error(`Service name already in use: ${spec.name}`);
    }
    this.usedServiceNames.add(spec.name);
    // Register with discover:* event
    this.config.insert([
      "eventListeners",
      `discover:${spec.selector}`,
    ], async (e: any) => {
      const matchResult = await spec.match(e.data);
      if (matchResult) {
        return {
          ...matchResult,
          name: spec.name,
        };
      }
    });
    // Register callback when invoked
    this.config.insert(["eventListeners", `service:${spec.name}`], (e: any) => {
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

  public async invoke(name: string, data: any): Promise<any> {
    const results = await this.eventHook.dispatchEvent(`service:${name}`, data);
    // Note: results may be an empty array in case no service actually returned a result (void) case, which is implicitly passed on here
    return results[0];
  }

  public async invokeBestMatch(selector: string, opts: any): Promise<any> {
    const results = await this.discover(selector, opts);
    if (results.length === 0) {
      throw new Error(`No services matching: ${selector}`);
    }
    return this.invoke(results[0].name, opts);
  }

  public clear() {
    this.usedServiceNames.clear();
  }
}
