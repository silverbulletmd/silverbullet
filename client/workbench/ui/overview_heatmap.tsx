import { useContext } from "preact/hooks";
import {
  activityWeeks,
  heatLevel,
  monthLabels,
  weekdayLabels,
} from "../activity.ts";
import type { OverviewActivity } from "../overview.ts";
import { LINKS } from "../overview_links.ts";
import { fmt, Go, Link } from "./overview_parts.tsx";

const LEVELS = [0, 1, 2, 3, 4] as const;

/** Edits per day as GitHub lays them out: a column per week, Monday on top. */
export function Heatmap({ activity }: { activity: OverviewActivity }) {
  const go = useContext(Go);
  const max = Math.max(0, ...activity.days.map((d) => d.count));
  const weeks = activityWeeks(activity.days);
  // Column 1 holds the weekday labels, row 1 the month labels
  return (
    <>
      <div
        className="sb-wbo-heat"
        style={{
          gridTemplateColumns: `auto repeat(${weeks.length}, var(--cell))`,
        }}
      >
        {monthLabels(weeks).map(({ column, label }) => (
          <span
            key={`m${column}`}
            className="sb-wbo-heat-month"
            style={{ gridColumn: column + 2, gridRow: 1 }}
          >
            {label}
          </span>
        ))}
        {weekdayLabels().map((label, row) => (
          <span
            key={`d${row}`}
            className="sb-wbo-heat-day"
            style={{ gridColumn: 1, gridRow: row + 2 }}
          >
            {label}
          </span>
        ))}
        {weeks.flatMap((week, column) =>
          week.map((d, row) => {
            if (!d) return null;
            const cls = `sb-wbo-cell sb-wb-heat-${heatLevel(d.count, max)}`;
            const title = `${d.date}: ${d.count} edits`;
            const place = { gridColumn: column + 2, gridRow: row + 2 };
            // A day without edits has nothing to look at in the log
            return d.count > 0 ? (
              <button
                type="button"
                key={d.date}
                className={cls}
                style={place}
                title={title}
                aria-label={`${title}, show in space log`}
                onClick={() => go(LINKS.spaceLog)}
              />
            ) : (
              <span key={d.date} className={cls} style={place} title={title} />
            );
          }),
        )}
      </div>
      <div className="sb-wbo-heat-foot">
        <Link to={LINKS.spaceLog} name="Show activity in space log">
          {`${fmt(activity.last7Days)} edits in the last 7 days`}
        </Link>
        <span className="sb-wbo-heat-legend" aria-hidden="true">
          Less
          {LEVELS.map((l) => (
            <span key={l} className={`sb-wbo-cell sb-wb-heat-${l}`} />
          ))}
          More
        </span>
      </div>
    </>
  );
}
