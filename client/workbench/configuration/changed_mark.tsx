/**
 * Says a setting differs from its default, saved or not, after the setting's
 * name. Where the setting can be edited, clicking it resets the setting
 * (until saved, like any other edit).
 */
export function ChangedMark(props: {
  name: string;
  writable: boolean;
  onReset: () => void;
}) {
  if (!props.writable) {
    return <span className="sb-wb-cfg-changed">Changed</span>;
  }
  return (
    <button
      type="button"
      className="sb-wb-cfg-changed"
      aria-label={`Reset ${props.name} to its default`}
      title="Changed from the default. Click to reset."
      onClick={props.onReset}
    >
      Changed
    </button>
  );
}
