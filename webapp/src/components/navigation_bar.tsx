import { PageMeta } from "../types";

export function NavigationBar({
  currentPage,
  onClick,
}: {
  currentPage?: PageMeta;
  onClick: () => void;
}) {
  return (
    <div id="top">
      <div className="current-page" onClick={onClick}>
        » {currentPage?.name}
      </div>
    </div>
  );
}
