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
      data: any,
    ): Promise<ServiceMatch[]> => {
      return serviceRegistry.discover(selector, data);
    },
    "service.invoke": (
      _ctx,
      service: ServiceMatch,
      data: any,
    ): Promise<any> => {
      return serviceRegistry.invoke(service, data);
    },
    "service.invokeBestMatch": (
      _ctx,
      selector: string,
      data: any,
    ): Promise<any> => {
      return serviceRegistry.invokeBestMatch(selector, data);
    },
  };
}
