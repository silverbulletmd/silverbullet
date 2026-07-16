import type {
  ServiceMatch,
  ServiceRegistry,
  ServiceSpec,
} from "../../service_registry.ts";
import type { SysCallMapping } from "../system.ts";

export function serviceRegistrySyscalls(
  serviceRegistry: ServiceRegistry,
): SysCallMapping {
  return {
    /**
     * Define a Lua event listener
     */
    "service.define": {
      callback: (_ctx, def: ServiceSpec) => {
        return serviceRegistry.define(def);
      },
      description: "Defines a service that can be discovered by selector.",
      parameters: [
        {
          name: "spec",
          type: "table",
          description: "Selector, match rule, and run callback.",
        },
      ],
      examples: [
        {
          code: 'service.define { selector = "greeter", match = {}, run = function(name) return "Hello " .. name end }',
        },
      ],
    },
    "service.discover": {
      callback: (
        _ctx,
        selector: string,
        data: any,
      ): Promise<ServiceMatch[]> => {
        return serviceRegistry.discover(selector, data);
      },
      description: "Discovers matching services sorted by descending priority.",
      parameters: [
        {
          name: "selector",
          type: "string",
          description: "Service selector.",
        },
        { name: "data", description: "Value passed to match callbacks." },
      ],
      returns: [
        { type: "table", description: "Matching service descriptors." },
      ],
    },
    "service.invoke": {
      callback: (_ctx, service: ServiceMatch, data: any): Promise<any> => {
        return serviceRegistry.invoke(service, data);
      },
      description: "Invokes a previously discovered service match.",
      parameters: [
        {
          name: "match",
          type: "table",
          description: "Service match returned by service.discover.",
        },
        { name: "data", description: "Value passed to the service." },
      ],
      returns: [{ description: "Service result." }],
    },
    "service.invokeBestMatch": {
      callback: (_ctx, selector: string, data: any): Promise<any> => {
        return serviceRegistry.invokeBestMatch(selector, data);
      },
      description:
        "Discovers and invokes the highest-priority matching service.",
      parameters: [
        {
          name: "selector",
          type: "string",
          description: "Service selector.",
        },
        {
          name: "data",
          description: "Value used for matching and invocation.",
        },
      ],
      returns: [{ description: "Best matching service result." }],
      examples: [
        {
          code: 'local greeting = service.invokeBestMatch("greeter", "Pete")',
        },
      ],
    },
  };
}
