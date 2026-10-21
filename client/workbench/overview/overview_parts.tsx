import { type ComponentChildren, createContext } from "preact";
import { useContext } from "preact/hooks";
import type { OverviewLink } from "./overview_links.ts";

/** Follows an Overview link; provided once by the Overview tab. */
export const Go = createContext<(to: OverviewLink) => void>(() => {});

/** A link target plus the accessible name saying where it goes. */
export type Dest = { to: OverviewLink; name: string };

export const fmt = (n: number) => n.toLocaleString();

/** A card links either as a whole (`whole`) or through its title. */
export function Card(props: {
  label: string;
  wide?: 2 | 4;
  link?: Dest & { whole?: boolean };
  children: ComponentChildren;
}) {
  const go = useContext(Go);
  const { link } = props;
  const label = <span className="sb-wbo-label">{props.label}</span>;
  return (
    <div className={`sb-wbo-card${props.wide ? ` sb-wbo-w${props.wide}` : ""}`}>
      {link?.whole ? (
        <button
          type="button"
          className="sb-wbo-hit"
          aria-label={link.name}
          onClick={() => go(link.to)}
        >
          {label}
          {props.children}
        </button>
      ) : (
        <>
          {link ? (
            <button
              type="button"
              className="sb-wbo-link sb-wbo-label"
              aria-label={link.name}
              onClick={() => go(link.to)}
            >
              {props.label}
            </button>
          ) : (
            label
          )}
          {props.children}
        </>
      )}
    </div>
  );
}

export function Link(
  props: Dest & { className?: string; children: ComponentChildren },
) {
  const go = useContext(Go);
  return (
    <button
      type="button"
      className={`sb-wbo-link${props.className ? ` ${props.className}` : ""}`}
      aria-label={props.name}
      onClick={() => go(props.to)}
    >
      {props.children}
    </button>
  );
}

export function Stat(props: {
  value: string | number;
  sub: ComponentChildren;
}) {
  return (
    <>
      <span className="sb-wbo-value">{props.value}</span>
      <span className="sb-wbo-sub">{props.sub}</span>
    </>
  );
}
