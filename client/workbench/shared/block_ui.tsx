import { Button } from "@silverbulletmd/silverbullet/ui";
import type { ComponentChildren, Ref } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import type { FocusTarget } from "../../navigator/ui/native_views.ts";
import {
  type BlockOrigin,
  blockLabels,
  blocksFrom,
  originCounts,
  type SpaceBlock,
} from "./blocks.ts";

/**
 * Shared by the Scripts and Styles tabs: a filterable list of `space-lua` or
 * `space-style` blocks, with the same toolbar, table and rows.
 */

const ORIGINS: { value: BlockOrigin; label: string }[] = [
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
  { value: "builtin", label: "Built-in" },
];

/** Something that replaces its whole last load at once: script loading, style loading. */
export type LoadSource<L> = {
  lastLoad: L | undefined;
  onLoad(fn: (load: L) => void): () => void;
};

/** The source's last load, kept current. */
export function useLoad<L>(source: LoadSource<L>): L | undefined {
  const [load, setLoad] = useState(source.lastLoad);
  useEffect(() => {
    setLoad(source.lastLoad);
    return source.onLoad(setLoad);
  }, [source]);
  return load;
}

/** The filter and origin state of a block list, and the blocks they let through. */
export function useBlockFilter<B extends SpaceBlock>(
  blocks: B[],
  focusTarget: FocusTarget,
) {
  const [phrase, setPhrase] = useState("");
  // Your own blocks first: the built-in ones are rarely what you're after
  const [origin, setOrigin] = useState(
    ORIGINS.findIndex((o) => o.value === "custom"),
  );
  const filterInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = filterInput.current;
    return el ? focusTarget(el) : undefined;
  }, [focusTarget]);

  const labels = useMemo(() => blockLabels(blocks), [blocks]);
  const origins = useMemo(() => originCounts(blocks), [blocks]);
  const fromOrigin = useMemo(
    () => blocksFrom(blocks, ORIGINS[origin].value),
    [blocks, origin],
  );
  return {
    phrase,
    setPhrase,
    origin,
    setOrigin,
    origins,
    fromOrigin,
    labels,
    filterInput,
  };
}

export type BlockFilter = ReturnType<typeof useBlockFilter>;

/** The filter field and origin buttons, then any `children`, then Reload. */
export function BlockToolbar({
  noun,
  filter,
  onReload,
  children,
}: {
  /** Plural, lower case: "scripts" */
  noun: string;
  filter: BlockFilter;
  onReload: () => void;
  children?: ComponentChildren;
}) {
  return (
    <div className="sb-wb-toolbar">
      <input
        ref={filter.filterInput as Ref<HTMLInputElement>}
        type="search"
        className="sb-wb-filter"
        placeholder={`Filter ${noun}`}
        aria-label={`Filter ${noun}`}
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        value={filter.phrase}
        onInput={(e) => filter.setPhrase(e.currentTarget.value)}
      />
      <SegmentedControl
        items={ORIGINS.map((o) => ({
          label: `${o.label} ${filter.origins[o.value]}`,
        }))}
        activeIndex={filter.origin}
        onPick={filter.setOrigin}
        takeFocus
        ariaLabel={`Show ${noun} from`}
      />
      {children}
      <Button onClick={onReload}>Reload</Button>
    </div>
  );
}

/** The table and its header row: status, block, and two numeric columns. */
export function BlockTable({
  label,
  columns,
  children,
}: {
  label: string;
  columns: [string, string, string];
  children: ComponentChildren;
}) {
  return (
    <div className="sb-wb-blocks" role="table" aria-label={label}>
      <div className="sb-wb-block sb-wb-block-head" role="row">
        <span role="columnheader" aria-label="Status" />
        <span role="columnheader">{columns[0]}</span>
        <span role="columnheader" className="sb-wb-num">
          {columns[1]}
        </span>
        <span role="columnheader" className="sb-wb-num">
          {columns[2]}
        </span>
        <span role="columnheader" aria-label="Actions" />
      </div>
      {children}
    </div>
  );
}

/** One block's row; clicking it opens the block's source. */
export function BlockRow({
  block,
  label,
  status,
  statusTitle,
  numbers,
  menu,
  onOpen,
}: {
  block: SpaceBlock;
  label: { page: string; pos?: number };
  /** Styles the row (`sb-wb-block-<status>`) and its status dot. */
  status: string;
  statusTitle: string;
  numbers: [ComponentChildren, ComponentChildren];
  menu: ComponentChildren;
  onOpen: () => void;
}) {
  return (
    <div
      className={`sb-wb-block sb-wb-block-${status}`}
      role="row"
      title={block.ref}
      onClick={onOpen}
    >
      <span
        className="sb-wb-status"
        role="cell"
        title={statusTitle}
        aria-label={statusTitle}
      />
      <span className="sb-wb-block-name" role="cell">
        {label.page}
        {label.pos !== undefined ? (
          <span className="sb-wb-muted">@{label.pos}</span>
        ) : null}
      </span>
      <span className="sb-wb-num" role="cell">
        {numbers[0]}
      </span>
      <span className="sb-wb-num" role="cell">
        {numbers[1]}
      </span>
      <span role="cell">{menu}</span>
    </div>
  );
}

/** A centered note in place of the table: disabled, not loaded yet, nothing there. */
export function BlockNote({ children }: { children: ComponentChildren }) {
  return <div className="sb-wb-empty">{children}</div>;
}
