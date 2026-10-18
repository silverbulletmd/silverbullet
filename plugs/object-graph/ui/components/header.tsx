import { Button } from "@silverbulletmd/silverbullet/ui";
import type { ComponentChildren } from "preact";
import { Crosshair, Sliders } from "preact-feather";

type Props = {
  /** Narrow (a sidebar dock): shorter labels, so the toolbar keeps to a row */
  compact: boolean;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  objectCount: number;
  relationCount: number;
  ghostCount: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  hideEdgeLabels: boolean;
  onToggleHideEdgeLabels: (v: boolean) => void;
  hideOrphans: boolean;
  onToggleHideOrphans: (v: boolean) => void;
};

/** The graph's toolbar; the view's own header holds its title and tabs. */
export function Header({
  compact,
  filtersOpen,
  onToggleFilters,
  objectCount,
  relationCount,
  ghostCount,
  onExpandAll,
  onCollapseAll,
  hideEdgeLabels,
  onToggleHideEdgeLabels,
  hideOrphans,
  onToggleHideOrphans,
}: Props) {
  return (
    <header class="gv-toolbar">
      <Chip
        pressed={filtersOpen}
        title="Show the filters and the selected object"
        label="Filters"
        onClick={onToggleFilters}
      >
        <Sliders size={13} />
        {compact ? null : "Filters"}
      </Chip>
      <div class="gv-toolbar-group" role="group" aria-label="Show">
        <Chip
          pressed={!hideEdgeLabels}
          title="Name each relation on the canvas"
          label="Edge labels"
          onClick={() => onToggleHideEdgeLabels(!hideEdgeLabels)}
        >
          {compact ? "Labels" : "Edge labels"}
        </Chip>
        <Chip
          pressed={!hideOrphans}
          title="Show objects with no visible relation"
          onClick={() => onToggleHideOrphans(!hideOrphans)}
        >
          Orphans
        </Chip>
      </div>
      <span class="gv-toolbar-spacer" />
      <span class="gv-stats">
        {objectCount} {objectCount === 1 ? "object" : "objects"} ·{" "}
        {relationCount} {relationCount === 1 ? "relation" : "relations"}
      </span>
      <Button
        title="Focus: reset to the selected object and its direct relations"
        aria-label="Focus"
        onClick={onCollapseAll}
      >
        {compact ? <Crosshair size={14} /> : "Focus"}
      </Button>
      <Button
        title="Follow every shown relation outward until nothing is left to add"
        disabled={ghostCount === 0}
        onClick={onExpandAll}
      >
        {compact ? "Expand" : "Expand all"}
        {ghostCount > 0 ? ` (${ghostCount})` : ""}
      </Button>
    </header>
  );
}

function Chip({
  pressed,
  title,
  label,
  onClick,
  children,
}: {
  pressed: boolean;
  title: string;
  /** The accessible name, when the visible text is shorter or absent */
  label?: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class="gv-chip"
      aria-pressed={pressed}
      aria-label={label}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
