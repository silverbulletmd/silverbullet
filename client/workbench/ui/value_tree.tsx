import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { useState } from "preact/hooks";
import type { Client } from "../../client.ts";
import {
  container,
  previewValue,
  type ValueChildren,
  valueChildren,
  valueKind,
} from "../value_preview.ts";

const PAGE_SIZE = 100;

// allPages is replaced (not mutated) on every update, so the array identity is a safe cache key
const pageNameCache = new WeakMap<PageMeta[], Set<string>>();

function pageNames(allPages: PageMeta[]): Set<string> {
  let names = pageNameCache.get(allPages);
  if (!names) {
    names = new Set(allPages.map((p) => p.name));
    pageNameCache.set(allPages, names);
  }
  return names;
}

export function ValueTree({
  value,
  client,
}: {
  value: unknown;
  client: Client;
}) {
  if (container(value)) return <Expandable value={value} client={client} />;
  switch (valueKind(value)) {
    case "string": {
      const s = value as string;
      if (pageNames(client.ui.viewState.allPages).has(s)) {
        return (
          <button
            type="button"
            className="sb-wb-link sb-wb-str"
            title={`Open ${s}`}
            onClick={() => void client.navigate({ path: `${s}.md` })}
          >
            {JSON.stringify(s)}
          </button>
        );
      }
      return <span className="sb-wb-str">{JSON.stringify(s)}</span>;
    }
    case "number":
    case "boolean":
      return <span className="sb-wb-num">{String(value)}</span>;
    case "nil":
      return <span className="sb-wb-nil">nil</span>;
    default:
      return <span className="sb-wb-other">{previewValue(value)}</span>;
  }
}

function Expandable({ value, client }: { value: unknown; client: Client }) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<ValueChildren[]>([]);

  const toggle = () => {
    if (!open && pages.length === 0) {
      setPages([valueChildren(value, 0, PAGE_SIZE)]);
    }
    setOpen(!open);
  };

  const loadMore = () => {
    const shown = pages.reduce((n, p) => n + p.entries.length, 0);
    setPages([...pages, valueChildren(value, shown, PAGE_SIZE)]);
  };

  const more = pages.at(-1)?.more ?? 0;
  return (
    <span className="sb-wb-tree">
      <button
        type="button"
        className="sb-wb-caret"
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? "▾" : "▸"}
      </button>
      <span className="sb-wb-preview">{previewValue(value)}</span>
      {open ? (
        <div className="sb-wb-children">
          {pages.flatMap((p) =>
            p.entries.map(([k, v]) => (
              <div className="sb-wb-child" key={k}>
                <span className="sb-wb-key">{k}</span>
                {": "}
                <ValueTree value={v} client={client} />
              </div>
            )),
          )}
          {more > 0 ? (
            <button type="button" className="sb-wb-more" onClick={loadMore}>
              … {more} more
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
