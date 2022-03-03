import { PageMeta } from "../types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileLines } from "@fortawesome/free-solid-svg-icons";

function prettyName(s: string | undefined): string {
  if (!s) {
    return "";
  }
  return s.replaceAll("/", " / ");
}

export function TopBar({
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
        <span className="current-page">{prettyName(currentPage?.name)}</span>
      </div>
    </div>
  );
}
