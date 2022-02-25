export function NavigationBar({
  currentNugget,
  onClick,
}: {
  currentNugget?: string;
  onClick: () => void;
}) {
  return (
    <div id="top">
      <div className="current-nugget" onClick={onClick}>
        » {currentNugget}
      </div>
    </div>
  );
}
