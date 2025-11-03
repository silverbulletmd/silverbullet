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
    "service.define": (
      _ctx,
      def: ServiceSpec,
    ) => {
      return serviceRegistry.define(def);
    },
    "service.discover": (
      _ctx,
      selector: string,
      opts: any,
    ): Promise<ServiceMatch[]> => {
      return serviceRegistry.discover(selector, opts);
    },
    "service.invoke": (
      _ctx,
      name: string,
      opts: any,
    ): Promise<any> => {
      return serviceRegistry.invoke(name, opts);
    },
    "service.invokeBestMatch": (
      _ctx,
      selector: string,
      opts: any,
    ): Promise<any> => {
      return serviceRegistry.invokeBestMatch(selector, opts);
    },
  };
}
