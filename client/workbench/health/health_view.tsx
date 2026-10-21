import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import { Button, Progress } from "@silverbulletmd/silverbullet/ui";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
} from "preact-feather";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import type { Client } from "../../client.ts";
import { showView } from "../../navigator/navigator.ts";
import { type Action, copyText, openRef } from "../shared/action.ts";
import { ActionMenu } from "../shared/action_menu.tsx";
import { BlockNote } from "../shared/block_ui.tsx";
import type { TabProps } from "../tab.ts";
import type { DeepCheckState } from "./deep_check.ts";
import {
  filterProblems,
  type HealthGroup,
  type HealthProblem,
  INSTANT_GROUPS,
  lintProblems,
  type Severity,
  severityCounts,
} from "./health.ts";

const SEVERITIES: { value: Severity | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "error", label: "Errors" },
  { value: "warning", label: "Warnings" },
  { value: "info", label: "Info" },
];

const GROUPS: Record<HealthGroup, string> = {
  broken: "Broken links",
  ambiguous: "Ambiguous links",
  scripts: "Scripts and styles",
  conflicts: "Merge conflicts",
  deep: "Space-wide lint",
};

const ROW_LIMIT = 20;
const fmt = (n: number) => n.toLocaleString();
const plural = (n: number, word: string) =>
  `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;

type RowDeps = { open: () => Promise<void>; copy: () => Promise<void> };

const OPEN: Action<RowDeps> = {
  label: "Open",
  icon: "open",
  run: (d) => d.open(),
};
const COPY: Action<RowDeps> = {
  label: "Copy message",
  icon: "copy",
  run: (d) => d.copy(),
};

const SPACE_ACTIONS: Action<Client>[] = [
  {
    label: "Reindex space",
    icon: "reload",
    run: async (client) => {
      await client.clientSystem.localSyscall("index.reindexSpace", []);
    },
  },
];

/** `get`'s value, re-read on each change `source` reports. */
function useWatched<T>(
  source: { onChange: (fn: () => void) => () => void },
  get: () => T,
): T {
  const [value, setValue] = useState(get);
  useEffect(() => {
    setValue(get());
    return source.onChange(() => setValue(get()));
  }, [source]);
  return value;
}

export function HealthView({ client, focusTarget, health }: TabProps) {
  const { deepCheck } = health;
  const instant = useWatched(health, () => health.instant);
  const deep = useWatched(deepCheck, () => deepCheck.state);
  const [phrase, setPhrase] = useState("");
  const [severity, setSeverity] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<HealthGroup>>(new Set());
  const [expanded, setExpanded] = useState<Set<HealthGroup>>(new Set());
  const filterInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = filterInput.current;
    return el ? focusTarget(el) : undefined;
  }, [focusTarget]);

  const deepProblems = useMemo(
    () => (deep.kind === "idle" ? [] : lintProblems(deep.found)),
    [deep],
  );
  const all = useMemo(
    () => [...(instant ?? []), ...deepProblems],
    [instant, deepProblems],
  );
  const counts = useMemo(
    () => severityCounts(filterProblems(all, "all", phrase)),
    [all, phrase],
  );
  const visible = useMemo(
    () => filterProblems(all, SEVERITIES[severity].value, phrase),
    [all, severity, phrase],
  );
  const filtering = severity !== 0 || phrase.trim() !== "";

  const toggle =
    (set: Set<HealthGroup>, update: (s: Set<HealthGroup>) => void) =>
    (g: HealthGroup) => {
      const next = new Set(set);
      if (!next.delete(g)) next.add(g);
      update(next);
    };
  const toggleCollapsed = toggle(collapsed, setCollapsed);
  const toggleExpanded = toggle(expanded, setExpanded);
  const inGroup = (ps: HealthProblem[], g: HealthGroup) =>
    ps.filter((p) => p.group === g);

  const section = (
    g: HealthGroup,
    rows: HealthProblem[],
    status?: ComponentChildren,
  ) => {
    const open = !collapsed.has(g);
    return (
      <section key={g} className="sb-wbh-group" aria-label={GROUPS[g]}>
        <GroupHeader
          group={g}
          count={rows.length}
          open={open}
          onToggle={() => toggleCollapsed(g)}
        />
        {open && status}
        {open && (
          <ProblemRows
            client={client}
            problems={rows}
            all={expanded.has(g)}
            onMore={() => toggleExpanded(g)}
          />
        )}
      </section>
    );
  };

  return (
    <div className="sb-workbench sb-wb-health">
      <div className="sb-wb-toolbar">
        <input
          ref={filterInput}
          type="search"
          className="sb-wb-filter"
          placeholder="Filter problems"
          aria-label="Filter problems"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          value={phrase}
          onInput={(e) => setPhrase(e.currentTarget.value)}
        />
        <SegmentedControl
          items={SEVERITIES.map((s) => ({
            label: `${s.label} ${counts[s.value]}`,
          }))}
          activeIndex={severity}
          onPick={setSeverity}
          takeFocus
          ariaLabel="Show problems"
        />
        <ActionMenu actions={SPACE_ACTIONS} deps={client} />
      </div>
      <div className="sb-workbench-body">
        {!instant && <BlockNote>Checking the space…</BlockNote>}
        {instant &&
          INSTANT_GROUPS.map((g) => {
            const rows = inGroup(visible, g);
            if (inGroup(all, g).length === 0) {
              return <CleanGroup key={g} group={g} />;
            }
            if (rows.length === 0 && filtering) return null;
            return section(g, rows);
          })}
        {section(
          "deep",
          inGroup(visible, "deep"),
          <DeepStatus
            state={deep}
            onRun={() => void deepCheck.run()}
            onCancel={() => deepCheck.cancel()}
          />,
        )}
      </div>
      <div className="sb-wb-footer">
        <span>{plural(all.length, "problem")}</span>
        {filtering && <span>{fmt(visible.length)} shown</span>}
      </div>
    </div>
  );
}

function GroupHeader(props: {
  group: HealthGroup;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const name = GROUPS[props.group];
  const Chevron = props.open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className="sb-wbh-head"
      aria-expanded={props.open}
      onClick={props.onToggle}
    >
      <Chevron size={14} className="sb-wbh-chevron" />
      <span className="sb-wbh-name">{name}</span>
      <span className="sb-wbh-count">{fmt(props.count)}</span>
    </button>
  );
}

function CleanGroup({ group }: { group: HealthGroup }) {
  const name = GROUPS[group];
  return (
    <div className="sb-wbh-clean">
      <Check size={14} className="sb-wbh-check" />
      <span>{name}</span>
    </div>
  );
}

function DeepStatus(props: {
  state: DeepCheckState;
  onRun: () => void;
  onCancel: () => void;
}) {
  const { state } = props;
  if (state.kind === "idle") {
    return (
      <DeepLine>
        <span className="sb-wbh-explain">
          Lints every page and renders every widget to find YAML, Lua, schema,
          anchor and widget errors. Takes a while on large spaces.
        </span>
        <Button variant="primary" onClick={props.onRun}>
          Run space-wide lint
        </Button>
      </DeepLine>
    );
  }
  if (state.kind === "running") {
    return (
      <DeepLine>
        <div className="sb-wbh-progress">
          <span>
            {fmt(state.done)} / {fmt(state.total)} pages
          </span>
          <Progress value={state.total ? state.done / state.total : 0} />
          <span className="sb-wbh-page">{state.page}</span>
          <span className="sb-wbh-hint">
            {plural(state.found.length, "finding")} so far
          </span>
        </div>
        <Button onClick={props.onCancel}>Cancel</Button>
      </DeepLine>
    );
  }
  const seconds = state.ms / 1000;
  const time = new Date(state.at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (
    <>
      <DeepLine>
        <span className="sb-wbh-hint">
          ran {time} · {plural(state.pages, "page")} ·{" "}
          {seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s
          {state.cancelled ? " · cancelled" : ""}
        </span>
        <Button onClick={props.onRun}>Run again</Button>
      </DeepLine>
      {state.error !== undefined ? (
        <div className="sb-wbh-failed" role="alert">
          Space-wide lint failed: {state.error}
        </div>
      ) : state.found.length === 0 ? (
        <div className="sb-wbh-clean">
          <Check size={14} className="sb-wbh-check" />
          <span>No problems found</span>
        </div>
      ) : null}
    </>
  );
}

function DeepLine({ children }: { children: ComponentChildren }) {
  return <div className="sb-wbh-deep">{children}</div>;
}

function ProblemRows(props: {
  client: Client;
  problems: HealthProblem[];
  all: boolean;
  onMore: () => void;
}) {
  const { problems } = props;
  const shown = props.all ? problems : problems.slice(0, ROW_LIMIT);
  return (
    <>
      {shown.map((p, i) => (
        <ProblemRow
          key={`${p.label}|${p.message}|${i}`}
          client={props.client}
          problem={p}
        />
      ))}
      {problems.length > shown.length && (
        <button type="button" className="sb-wbh-more" onClick={props.onMore}>
          + {fmt(problems.length - shown.length)} more
        </button>
      )}
    </>
  );
}

const SEVERITY_ICONS = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

function ProblemRow({
  client,
  problem,
}: {
  client: Client;
  problem: HealthProblem;
}) {
  const { target } = problem;
  const refText = target && "ref" in target ? target.ref : undefined;
  const ref = refText ? parseToRef(refText) : null;
  const view = target && "view" in target ? target.view : undefined;
  const canOpen = !!ref || !!view;
  const open = async () => {
    if (ref) await openRef(client, ref);
    else if (view) await showView(view);
  };
  const deps: RowDeps = {
    open,
    copy: () => copyText(client, problem.message),
  };
  const line =
    ref?.details?.type === "linecolumn" ? `:${ref.details.line}` : "";
  const Icon = SEVERITY_ICONS[problem.severity];
  const hint = refText ? ` (${refText})` : "";
  return (
    <div
      className={`sb-wbh-row sb-wbh-${problem.severity}${canOpen ? " sb-wbh-openable" : ""}`}
      title={refText}
      onClick={canOpen ? () => void open() : undefined}
    >
      <div
        className="sb-wbh-main"
        role={canOpen ? "button" : undefined}
        tabIndex={canOpen ? 0 : undefined}
        aria-label={
          canOpen
            ? `Open ${problem.severity}: ${problem.label}${line}, ${problem.message}${hint}`
            : undefined
        }
        onKeyDown={
          canOpen
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void open();
                }
              }
            : undefined
        }
      >
        <Icon size={14} className="sb-wbh-icon" aria-hidden="true" />
        <span className="sb-wbh-label">
          {problem.label}
          {line}
        </span>
        <span className="sb-wbh-message">{problem.message}</span>
        <span className="sb-wbh-source">{problem.source}</span>
      </div>
      <ActionMenu actions={canOpen ? [OPEN, COPY] : [COPY]} deps={deps} />
    </div>
  );
}
