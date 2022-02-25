import { NuggetMeta } from "../types";

export function NavigationBar({
  currentNugget,
  onClick,
}: {
  currentNugget?: NuggetMeta;
  onClick: () => void;
}) {
  return (
    <div id="top">
      <div className="current-nugget" onClick={onClick}>
        » {currentNugget?.name}
      </div>
    </div>
  );
}
