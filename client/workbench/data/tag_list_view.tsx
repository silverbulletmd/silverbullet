import type { RefObject } from "preact";
import { resolveIconMarkup } from "../../lib/icon.ts";
import type { DataModel, DataSection } from "./data_model.ts";
import { allEntries, filterTagList, type TagListEntry } from "./tag_list.ts";

export function TagIcon({ icon }: { icon: string }) {
  const markup = resolveIconMarkup(icon) ?? resolveIconMarkup("tag") ?? "";
  return (
    <span
      className="sb-wbd-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

// Feather has no pin; an outline pushpin drawn in its style (Tabler's, MIT)
const PIN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/></svg>';

const SECTIONS: { key: DataSection; label: string }[] = [
  { key: "defined", label: "Defined" },
  { key: "noSchema", label: "No schema" },
  { key: "builtIn", label: "Built-in" },
];

/**
 * The Data tab's tag list: pinned tags, then Defined, No schema and Built-in.
 * Filtering narrows every section and opens collapsed ones.
 */
export function TagListView({
  data,
  phrase,
  setPhrase,
  filterRef,
  onPick,
  onTogglePin,
  pinned,
  writable,
}: {
  data: DataModel;
  phrase: string;
  setPhrase: (p: string) => void;
  filterRef: RefObject<HTMLInputElement>;
  onPick: (entry: TagListEntry) => void;
  onTogglePin: (name: string) => void;
  pinned: string[];
  writable: boolean;
}) {
  const shown = data.tags ? filterTagList(data.tags, phrase) : null;
  const first = shown ? allEntries(shown)[0] : undefined;
  const filtering = phrase.trim() !== "";

  const row = (e: TagListEntry) => {
    const on = e.name === data.selected;
    const isPinned = pinned.includes(e.name);
    return (
      <div key={e.name} className="sb-wbd-row">
        <button
          type="button"
          className={`sb-wbq-tag${on ? " sb-wbq-tag-on" : ""}${e.count === 0 ? " sb-wbd-empty" : ""}`}
          aria-pressed={on}
          onClick={() => onPick(e)}
        >
          <TagIcon icon={e.icon} />
          <span className="sb-wbd-name">{e.name}</span>
          {e.data ? <span className="sb-wbd-pill">data</span> : null}
          {e.invalid ? (
            <span
              className="sb-wbd-invalid"
              title={`${e.invalid} sampled objects don't match the schema`}
            >
              ⚠{e.invalid}
            </span>
          ) : null}
          <span className="sb-wbq-count">{e.count}</span>
        </button>
        {writable ? (
          <button
            type="button"
            className={`sb-wbd-pin${isPinned ? " sb-wbd-pin-on" : ""}`}
            aria-label={`${isPinned ? "Unpin" : "Pin"} ${e.name}`}
            title={isPinned ? "Unpin" : "Pin to the top"}
            onClick={() => onTogglePin(e.name)}
          >
            <TagIcon icon={PIN_ICON} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <nav className="sb-wbq-tags" aria-label="Tags">
      <input
        ref={filterRef}
        type="search"
        className="sb-wbq-tagfilter"
        aria-label="Filter tags"
        placeholder="Filter tags"
        value={phrase}
        onInput={(e) => setPhrase(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (first) onPick(first);
          } else if (e.key === "Escape" && phrase) {
            // Clears the filter; a second Escape is the panel's
            e.preventDefault();
            e.stopPropagation();
            setPhrase("");
          }
        }}
      />
      {!shown ? (
        <div className="sb-wbq-note sb-wbq-nomatch">
          {data.loadError
            ? `Couldn't list tags: ${data.loadError}`
            : "Loading tags…"}
        </div>
      ) : (
        <>
          {shown.pinned.map(row)}
          {SECTIONS.map(({ key, label }) => {
            const list = shown[key];
            const open = filtering || !data.isCollapsed(key);
            return (
              <div key={key} className="sb-wbd-group">
                <button
                  type="button"
                  className="sb-wbd-section"
                  aria-expanded={open}
                  onClick={() => data.toggleSection(key)}
                >
                  <span className="sb-wbd-chevron">
                    <TagIcon icon={open ? "chevron-down" : "chevron-right"} />
                  </span>
                  <span>{label}</span>
                </button>
                {open ? list.map(row) : null}
              </div>
            );
          })}
          {!first ? (
            <div className="sb-wbq-note sb-wbq-nomatch">No tags match</div>
          ) : null}
        </>
      )}
    </nav>
  );
}
