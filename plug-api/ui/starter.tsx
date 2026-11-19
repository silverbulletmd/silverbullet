import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Alert } from "./alert.tsx";
import { Field } from "./field.tsx";
import { Input } from "./input.tsx";
import type { PickableKit, StarterOutcome } from "../types/starter_kits.ts";
import { type GalleryChoice, StarterGallery } from "./starter_gallery.tsx";

export type {
  InterfaceLevel,
  KitInfo,
  PickableKit,
  Starter,
  StarterContent,
  StarterOutcome,
} from "../types/starter_kits.ts";

/** After creation, when the starter was skipped. */
export const HAS_NOTES_MESSAGE =
  "This folder already has notes; no starter content was added";

/** Before creation, next to the folder field. */
export const HAS_NOTES_WARNING =
  "This folder already has notes; no starter content will be added";

/** What to tell the user about a new space's starter content, if anything. */
export function starterNotice(outcome: StarterOutcome): string | undefined {
  if (outcome.starterContent === "skipped") return HAS_NOTES_MESSAGE;
  if (outcome.starterContent === "failed")
    return `The space was created, but its starter content could not be added: ${outcome.starterError}`;
  return undefined;
}

/** The kits and the user's pick for a new-space form; inert while `active` is false. */
export function useStarterChoice(
  active: boolean,
  loadKits: () => Promise<PickableKit[]>,
) {
  const [kits, setKits] = useState<PickableKit[]>();
  const [loadError, setLoadError] = useState(false);
  const [choice, setChoice] = useState<GalleryChoice>();
  const [gitUrl, setGitUrl] = useState("");
  const kit =
    choice?.type === "kit" ? kits?.find((k) => k.id === choice.id) : undefined;

  useEffect(() => {
    if (!active) return;
    let live = true;
    loadKits()
      .then((list) => live && setKits(list))
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [active]);

  return { kits, loadError, choice, kit, pick: setChoice, gitUrl, setGitUrl };
}

export type StarterChoice = ReturnType<typeof useStarterChoice>;

/** The gallery a new space starts from. */
export function StarterPicker({ starter }: { starter: StarterChoice }) {
  if (starter.loadError)
    return <Alert variant="error">Could not load the starter kits.</Alert>;
  if (!starter.kits) return <p>Loading…</p>;
  return <StarterGallery showGit kits={starter.kits} onPick={starter.pick} />;
}

/** The chosen starter and its options, shown above the other create fields. */
export function StarterFields({
  starter,
  hasNotes,
  gitUrlError,
  starterError,
  gitOptions,
}: {
  starter: StarterChoice;
  /** Shows the warning that no starter content will be added. */
  hasNotes: boolean;
  gitUrlError?: string;
  starterError?: string;
  /** Rendered under the Git URL when the Git starter is chosen. */
  gitOptions?: ComponentChildren;
}) {
  const { choice, kit } = starter;
  const name = choice?.type === "git" ? "A Git repository" : kit?.name;
  return (
    <div class="sb-starter-choice">
      <p>
        Starting from: <strong>{name}</strong> ·{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            starter.pick(undefined);
          }}
        >
          Change
        </a>
      </p>
      {starterError && (
        <span id="space-starter-error" class="sb-field-error" role="alert">
          {starterError}
        </span>
      )}
      {hasNotes && <Alert variant="info">{HAS_NOTES_WARNING}</Alert>}
      {choice?.type === "git" && (
        <>
          <Field label="Git repository URL" error={gitUrlError}>
            <Input
              id="space-git-url"
              placeholder="https://github.com/example/notes"
              value={starter.gitUrl}
              onInput={(e) => starter.setGitUrl(e.currentTarget.value)}
            />
          </Field>
          {gitOptions}
        </>
      )}
    </div>
  );
}
