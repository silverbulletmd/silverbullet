import type { SysCallMapping } from "../../lib/plugos/system.ts";
import { Ajv } from "ajv";

const ajv = new Ajv();

ajv.addFormat("email", {
  validate: (data: string) => {
    // TODO: Implement email validation
    return data.includes("@");
  },
  async: false,
});

ajv.addFormat("page-ref", {
  validate: (data: string) => {
    return data.startsWith("[[") && data.endsWith("]]");
  },
  async: false,
});

export function jsonschemaSyscalls(): SysCallMapping {
  return {
    "jsonschema.validateObject": (
      _ctx,
      schema: any,
      object: any,
    ): undefined | string => {
      try {
        const validate = ajv.compile(schema);
        if (validate(object)) {
          return;
        } else {
          let text = ajv.errorsText(validate.errors);
          text = text.replaceAll("/", ".");
          text = text.replace(/^data[\.\s]/, "");
          return text;
        }
      } catch (e: any) {
        return e.message;
      }
    },
    "jsonschema.validateSchema": (
      _ctx,
      schema: any,
    ): undefined | string => {
      const valid = ajv.validateSchema(schema);
      if (valid) {
        return;
      } else {
        return ajv.errorsText(ajv.errors);
      }
    },
  };
}
