import { Button, revealInContainer } from "@silverbulletmd/silverbullet/ui";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import { openPopupMenu } from "../../components/popup_menu.ts";
import { expandRefreshTriggers } from "../../navigator/refresh_triggers.ts";
import type { ConsoleContext } from "./console_session.ts";
import { copyValue } from "../../codemirror/widgets/directive_actions.ts";
import { copyText, openRef } from "../shared/action.ts";
import type { TabProps } from "../tab.ts";
import { consoleLog, type LogEntry } from "./console_log.ts";
import { frameThrottle } from "./frame_throttle.ts";
import { filterEntries, type SourceFilter } from "./log_filter.ts";
import { LogView, type RowContext } from "./log_view.tsx";
import { ReplInput } from "./repl_input.tsx";

const SOURCES: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "lua", label: "Lua" },
  { value: "js", label: "JS" },
  { value: "plug", label: "Plug" },
  { value: "sw", label: "SW" },
  { value: "error", label: "Error" },
];

const FLASH_MS = 1000;
// Within this many pixels of the end still counts as "at the bottom"
const STICKY_SLACK_PX = 8;

export function ConsoleView({ client, session, focusTarget }: TabProps) {
  const [context, setContext] = useState(session.context);
  const [pageName, setPageName] = useState(() => client.currentName());
  const closeContextMenu = useRef<() => void>();
  const [phrase, setPhrase] = useState("");
  const [source, setSource] = useState(0);
  const [entries, setEntries] = useState<LogEntry[]>(() => [
    ...consoleLog.entries,
  ]);
  const body = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    setEntries([...consoleLog.entries]);
    // Logging bursts would otherwise re-render the panel once per entry
    const update = frameThrottle((all: LogEntry[]) => setEntries([...all]));
    const unsubscribe = consoleLog.subscribe(update.call);
    return () => {
      unsubscribe();
      update.cancel();
    };
  }, []);

  useEffect(() => {
    const update = () => setPageName(client.currentName());
    const events = expandRefreshTriggers(["navigate"]);
    for (const event of events)
      client.eventHook.addLocalListener(event, update);
    update();
    return () => {
      for (const event of events)
        client.eventHook.removeLocalListener(event, update);
    };
  }, [client]);

  useEffect(() => () => closeContextMenu.current?.(), [context, pageName]);

  const visible = useMemo(
    () => filterEntries(entries, phrase, SOURCES[source].value),
    [entries, phrase, source],
  );

  useLayoutEffect(() => {
    const el = body.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // The log stays at its end when it grows (rendered results arrive
  // asynchronously, after their row was scrolled into view) and when the
  // panel shrinks (an on-screen keyboard opening)
  useEffect(() => {
    const el = body.current;
    const log = el?.firstElementChild;
    if (!el || !log) return;
    // Scrolling inside the callback can resize the log again within one
    // delivery, which the browser reports as a "ResizeObserver loop" error
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (atBottom.current) el.scrollTop = el.scrollHeight;
      });
    });
    observer.observe(log);
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const onScroll = () => {
    const el = body.current;
    if (!el) return;
    atBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= STICKY_SLACK_PX;
  };

  // Stable, so memoized log rows don't re-render
  const rowContext = useMemo((): RowContext => {
    const flashInput = (ref: string) => {
      const el = body.current?.querySelector(
        `[data-console-ref="${CSS.escape(ref)}"]`,
      );
      if (!el || !body.current) return;
      revealInContainer(el, body.current);
      el.classList.add("sb-wb-flash");
      setTimeout(() => el.classList.remove("sb-wb-flash"), FLASH_MS);
    };
    return {
      client,
      sourceFor: (ref) =>
        session.sourceFor(ref) ??
        client.clientSystem.spaceLuaEnv.sourceFor(ref),
      actions: {
        copyText: (text) => copyText(client, text),
        copyValue: (value) => copyValue(client, value),
        rerun: (code, page) => session.run(code, page),
      },
      onOpen: (target) =>
        target.kind === "console"
          ? flashInput(target.ref)
          : void openRef(client, target.ref),
    };
  }, [client, session]);

  return (
    <div className="sb-workbench">
      <div className="sb-wb-toolbar">
        <input
          type="search"
          className="sb-wb-filter"
          placeholder="Filter log"
          aria-label="Filter log"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          value={phrase}
          onInput={(e) => setPhrase(e.currentTarget.value)}
        />
        <SegmentedControl
          items={SOURCES.map((s) => ({ label: s.label }))}
          activeIndex={source}
          onPick={setSource}
          takeFocus
          ariaLabel="Show entries from"
        />
        <Button
          class="sb-wb-context"
          aria-label="Console context"
          aria-haspopup="menu"
          title={context === "space" ? "Space" : `Current page: ${pageName}`}
          onClick={(e) => {
            const anchor = e.currentTarget;
            if (anchor.getAttribute("aria-expanded") === "true") {
              closeContextMenu.current?.();
              return;
            }
            closeContextMenu.current = openPopupMenu<ConsoleContext>(
              anchor,
              [
                {
                  kind: "item",
                  id: "space",
                  label: "Space",
                  icon: "",
                  current: context === "space",
                },
                {
                  kind: "item",
                  id: "page",
                  label: `Current page: ${pageName}`,
                  icon: "",
                  current: context === "page",
                },
              ],
              (next) => {
                session.context = next;
                setContext(next);
                anchor.focus();
              },
            );
          }}
        >
          {context === "space" ? "Space" : "Page"}{" "}
          <span aria-hidden="true">▾</span>
        </Button>
        <Button onClick={() => consoleLog.clear()}>Clear</Button>
      </div>
      <div className="sb-workbench-body" ref={body} onScroll={onScroll}>
        <LogView entries={visible} ctx={rowContext} />
      </div>
      <ReplInput
        client={client}
        session={session}
        focusTarget={focusTarget}
        context={context}
        pageName={pageName}
      />
    </div>
  );
}
