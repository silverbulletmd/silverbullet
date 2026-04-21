import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ConfigurationViewModel } from "./types.ts";
import type { SchemaIndex } from "./schema.ts";

export type CfgValue = {
  cfg: ConfigurationViewModel;
  schemaIndex: SchemaIndex;
};

export const CfgContext = createContext<CfgValue | null>(null);

export function useCfg(): CfgValue {
  const v = useContext(CfgContext);
  if (!v) throw new Error("CfgContext not provided");
  return v;
}
