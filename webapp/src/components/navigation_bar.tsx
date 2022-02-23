export function NavigationBar({
  currentNote,
  onClick,
}: {
  currentNote?: string;
  onClick: () => void;
}) {
  return (
    <div id="top">
      <div className="current-note" onClick={onClick}>
        » {currentNote}
      </div>
    </div>
  );
}
