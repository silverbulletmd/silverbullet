import type { SysCallMapping } from "../system.ts";
import { rank, type RankOptions } from "../../../plug-api/lib/fuzzy.ts";

export function searchSyscalls(): SysCallMapping {
  return {
    "search.rank": {
      callback: (
        _ctx,
        objects: Record<string, any>[],
        phrase: string,
        options?: {
          fields?: Record<
            string,
            number | { weight: number; segments?: boolean }
          >;
        },
      ) => rank(objects, phrase, options as RankOptions<any>),
      description:
        "Fuzzy-ranks objects against a phrase, best match first. The same ranker the navigator's own filtering uses.",
      parameters: [
        { name: "objects", type: "table", description: "Objects to rank." },
        {
          name: "phrase",
          type: "string",
          description:
            "Phrase to match against. An empty phrase returns every object, in the order given.",
        },
        {
          name: "options",
          type: "table",
          description:
            "Ranking options. `fields` maps a field name to its weight, or to `{ weight, segments = true }` to also score the parts of a `/`-separated value.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "table",
          description: "The matching objects, best match first.",
        },
      ],
    },
  };
}
