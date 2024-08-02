import type { SysCallMapping } from "../../lib/plugos/system.ts";
import Ajv from "ajv";

const ajv = new Ajv();

export function jsonschemaSyscalls(): SysCallMapping {
  return {
    "jsonschema.validateObject": (
      _ctx,
      schema: any,
      object: any,
    ): undefined | string => {
      const validate = ajv.compile(schema);
      if (validate(object)) {
        return;
      } else {
        let text = ajv.errorsText(validate.errors);
        text = text.replaceAll("/", ".");
        text = text.replace(/^data\./, "");
        return text;
      }
    },
  };
}
