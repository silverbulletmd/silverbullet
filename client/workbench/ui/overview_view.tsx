import { latestOnly } from "@silverbulletmd/silverbullet/lib/async";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { subscribeRefresh } from "../../navigator/page_widget_logic.ts";
import { expandRefreshTriggers } from "../../navigator/refresh_triggers.ts";
import { type GitState, gitSources, loadGitState } from "../git_state.ts";
import {
  gitHeadline,
  loadActivity,
  loadOverview,
  loadRuntime,
  type OverviewActivity,
  type OverviewStats,
  overviewDeps,
  type Runtime,
  showAuthors,
} from "../overview.ts";
import {
  followOverviewLink,
  LINKS,
  type OverviewLink,
} from "../overview_links.ts";
import { Heatmap } from "./overview_heatmap.tsx";
import { Card, fmt, Go, Link, Stat } from "./overview_parts.tsx";
import type { TabProps } from "./tab.ts";

const NETWORK_REFRESH_MS = 60_000;

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function ago(ms: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - ms) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function OverviewView({ client, builder, showing }: TabProps) {
  const [stats, setStats] = useState<OverviewStats>();
  // undefined while loading, null when revisions are off or the call failed
  const [activity, setActivity] = useState<OverviewActivity | null>();
  const [git, setGit] = useState<GitState>();
  const [runtime, setRuntime] = useState<Runtime>();
  const [failed, setFailed] = useState(false);

  const loaders = useMemo(
    () => ({
      stats: latestOnly(
        () => loadOverview(overviewDeps(client), new Date()),
        setStats,
      ),
      activity: latestOnly(
        () => loadActivity(overviewDeps(client), new Date()),
        setActivity,
      ),
      git: latestOnly(() => loadGitState(gitSources), setGit),
      runtime: latestOnly(() => loadRuntime(client), setRuntime),
    }),
    [client],
  );
  // Tabs stay mounted: a hidden one loads nothing and follows no events
  useEffect(() => {
    if (!showing) return;
    const stats = () =>
      void loaders.stats.run().catch((e) => {
        console.error("Workbench overview failed to load", e);
        setFailed(true);
      });
    const network = () => {
      void loaders.activity.run();
      void loaders.git.run();
    };
    const runtime = () =>
      void loaders.runtime.run().catch(() => setRuntime(undefined));
    stats();
    network();
    runtime();
    // Index counts follow index events; the network calls a slower timer
    const offIndex = subscribeRefresh(
      client.clientSystem.eventHook,
      expandRefreshTriggers(["index"]),
      stats,
    );
    const timer = setInterval(network, NETWORK_REFRESH_MS);
    // Scripts and styles load after the first paint; follow them while showing
    const offScripts = client.clientSystem.spaceLuaEnv.onLoad(runtime);
    const offStyles = client.spaceStyles.onLoad(runtime);
    return () => {
      offIndex();
      clearInterval(timer);
      offScripts();
      offStyles();
    };
  }, [client, showing, loaders]);

  const go = useCallback(
    (to: OverviewLink) => void followOverviewLink(client, builder, to),
    [client, builder],
  );

  if (!stats) {
    return (
      <div className="sb-wb-empty">
        {failed ? "Couldn't load the overview." : "Loading…"}
      </div>
    );
  }
  const now = Date.now();
  const headline = git && gitHeadline(git.snapshot, git.conflicts?.length);
  const conflicts = git?.conflicts?.length;

  return (
    <Go.Provider value={go}>
      <div className="sb-wb-overview">
        {!stats.indexReady && (
          <div className="sb-wb-empty">
            Still indexing; counts will fill in.
          </div>
        )}
        <div className="sb-wbo-grid">
          <Card
            label="Pages"
            link={{ to: LINKS.pages, name: "Show pages in Query", whole: true }}
          >
            <Stat
              value={fmt(stats.pages)}
              sub={`+${fmt(stats.pagesThisMonth)} this month`}
            />
          </Card>
          <Card label="Tasks">
            <Stat
              value={fmt(stats.tasksOpen + stats.tasksDone)}
              sub={
                <>
                  <Link to={LINKS.tasksOpen} name="Show open tasks in Query">
                    {fmt(stats.tasksOpen)} open
                  </Link>
                  {" · "}
                  <Link to={LINKS.tasksDone} name="Show done tasks in Query">
                    {fmt(stats.tasksDone)} done
                  </Link>
                </>
              }
            />
          </Card>
          <Card
            label="Links"
            link={{ to: LINKS.links, name: "Show links in Query", whole: true }}
          >
            <Stat value={fmt(stats.relations)} sub="links and mentions" />
          </Card>
          <Card
            label="Documents"
            link={{
              to: LINKS.documents,
              name: "Show documents in Query",
              whole: true,
            }}
          >
            <Stat
              value={fmt(stats.documents)}
              sub={`${formatSize(stats.documentBytes)} total`}
            />
          </Card>
          <Card label="Top tags" wide={4}>
            <div className="sb-wbo-pills">
              {stats.tags.map((t) => (
                <button
                  type="button"
                  key={t.name}
                  className="sb-wbo-pill"
                  aria-label={`Open tag page for #${t.name}`}
                  onClick={() => go({ kind: "tagPage", tag: t.name })}
                >
                  #{t.name} <b>{fmt(t.count)}</b>
                </button>
              ))}
              <Link to={LINKS.allTags} name="Show all tags in Query">
                {fmt(stats.tagTotal)} in use · all tags →
              </Link>
            </div>
          </Card>
          {activity && (
            <>
              <Card
                label="Activity"
                wide={2}
                link={{
                  to: LINKS.spaceLog,
                  name: "Show activity in space log",
                }}
              >
                <Heatmap activity={activity} />
              </Card>
              <Card
                label="Most edited in the last month"
                wide={2}
                link={{
                  to: LINKS.spaceLog,
                  name: "Show most edited in the last month in space log",
                }}
              >
                <div className="sb-wbo-rows">
                  {activity.topFiles.length === 0 && (
                    <div className="sb-wbo-sub">No edits yet</div>
                  )}
                  {activity.topFiles.map((f) => (
                    <button
                      type="button"
                      key={f.page}
                      className="sb-wbo-row"
                      aria-label={`Open ${f.page}`}
                      onClick={() => go({ kind: "page", page: f.page })}
                    >
                      <span className="sb-wbo-name">{f.page}</span>
                      <span className="sb-wbo-sub">{fmt(f.count)}</span>
                    </button>
                  ))}
                </div>
              </Card>
              {showAuthors(activity) && (
                <Card
                  label="Edits by person in the last month"
                  wide={2}
                  link={{
                    to: LINKS.spaceLog,
                    name: "Show edits by person in space log",
                  }}
                >
                  <div className="sb-wbo-rows">
                    {activity.authors.map((a) => (
                      <div key={a.name} className="sb-wbo-row sb-wbo-static">
                        <span className="sb-wbo-name">{a.name}</span>
                        <span className="sb-wbo-sub">{fmt(a.count)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
          {git && headline && (
            <Card
              label="Git sync"
              wide={2}
              link={{ to: LINKS.gitStatus, name: "Show Git status" }}
            >
              <div
                className={`sb-wbo-value${headline.tone ? ` sb-wbo-${headline.tone}` : ""}`}
              >
                {headline.to ? (
                  <Link
                    to={headline.to}
                    name="Show conflicts in Health"
                    className={headline.tone && `sb-wbo-${headline.tone}`}
                  >
                    {headline.text}
                  </Link>
                ) : (
                  headline.text
                )}
              </div>
              <div className="sb-wbo-sub">
                {git.snapshot.lastSuccess
                  ? `last sync ${ago(git.snapshot.lastSuccess, now)}`
                  : "not synced yet"}
                {!!conflicts && !headline.to && (
                  <>
                    {" · "}
                    <Link
                      to={LINKS.health}
                      name="Show conflicts in Health"
                      className="sb-wbo-danger"
                    >
                      {fmt(conflicts)} conflicts
                    </Link>
                  </>
                )}
              </div>
            </Card>
          )}
          {runtime && (
            <Card label="Runtime" wide={2}>
              <dl className="sb-wbo-kv">
                <dt>Version</dt>
                <dd>{runtime.version}</dd>
                <dt>Scripts</dt>
                <dd>
                  <Link to={LINKS.scripts} name="Show Scripts tab">
                    {fmt(runtime.scripts)}
                    {runtime.scriptsFailed > 0 && (
                      <span className="sb-wbo-danger">
                        {" "}
                        · {fmt(runtime.scriptsFailed)} failed
                      </span>
                    )}
                  </Link>
                </dd>
                <dt>Styles</dt>
                <dd>
                  <Link to={LINKS.styles} name="Show Styles tab">
                    {fmt(runtime.styles)}
                    {runtime.stylesEmpty > 0 && (
                      <span className="sb-wbo-danger">
                        {" "}
                        · {fmt(runtime.stylesEmpty)} empty
                      </span>
                    )}
                  </Link>
                </dd>
              </dl>
            </Card>
          )}
        </div>
      </div>
    </Go.Provider>
  );
}
