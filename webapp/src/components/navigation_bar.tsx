import { PageMeta } from "../types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileLines } from "@fortawesome/free-solid-svg-icons";

export function NavigationBar({
  currentPage,
  onClick,
}: {
  currentPage?: PageMeta;
  onClick: () => void;
}) {
  return (
    <div id="top" onClick={onClick}>
      <div className="inner">
        <span className="icon">
          <FontAwesomeIcon icon={faFileLines} />
        </span>
        <span className="current-page">{currentPage?.name}</span>
      </div>
    </div>
  );
}
