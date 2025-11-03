import type { EventHook } from "./plugos/hooks/event.ts";

export type ServiceMatch = {
  priority?: number;
} & Record<string, any>;

export type ServiceSpec = {
  name: string;
  selector: string;
  match: (opts: any) => Promise<ServiceMatch | null | undefined>;
  run: (opts: any) => Promise<any>;
};

export class ServiceRegistry {
  private usedServiceNames = new Set<string>();
  constructor(private eventHook: EventHook) {
  }

  public define(spec: ServiceSpec): void {
    if (this.usedServiceNames.has(spec.name)) {
      throw new Error(`Service name already in use: ${spec.name}`);
    }
    this.usedServiceNames.add(spec.name);
    // Register with discover:* event
    this.eventHook.addLocalListener(
      `discover:${spec.selector}`,
      async (opts) => {
        const matchResult = await spec.match(opts);
        if (matchResult) {
          return {
            ...matchResult,
            name: spec.name,
          };
        }
      },
    );
    // Register callback when invoked
    this.eventHook.addLocalListener(spec.name, spec.run);
  }

  public async discover(selector: string, opts: any): Promise<ServiceMatch[]> {
    const discoveryResults: ServiceMatch[] = await this.eventHook.dispatchEvent(
      `discover:${selector}`,
      opts,
    );
    discoveryResults.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return discoveryResults;
  }

  public async invoke(name: string, opt: any): Promise<any> {
    const results = await this.eventHook.dispatchEvent(name, opt);
    if (results.length === 0) {
      throw new Error(`Service not found: ${name}`);
    }
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
