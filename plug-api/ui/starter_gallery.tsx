import { Icon } from "./icon.tsx";

export type GalleryKit = {
  id: string;
  name: string;
  description: string;
  previewUrl?: string;
  /** Lucide icon name shown when there is no preview image; defaults to `file`. */
  icon?: string;
};

function CardIcon({ name }: { name?: string }) {
  const icon = name || "file";
  return (
    <span data-icon={icon} aria-hidden="true">
      <Icon name={icon} size={32} />
    </span>
  );
}

export type GalleryChoice = { type: "kit"; id: string } | { type: "git" };

export type StarterGalleryProps = {
  kits: GalleryKit[];
  onPick: (choice: GalleryChoice) => void;
  showGit: boolean;
  /** Marks the card for this kit id, or the Git card for `"git"`. */
  selectedId?: string;
};

const GIT_NAME = "From a Git repository";
const GIT_DESCRIPTION = "Start from a Git repository";

function Card({
  name,
  description,
  previewUrl,
  icon,
  selected,
  onClick,
}: {
  name: string;
  description: string;
  previewUrl?: string;
  icon?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="sb-starter-card"
      aria-label={name}
      aria-pressed={selected === undefined ? undefined : selected}
      onClick={onClick}
    >
      {previewUrl ? (
        <img class="sb-starter-preview" src={previewUrl} alt="" />
      ) : (
        <span class="sb-starter-preview sb-starter-preview-empty">
          <CardIcon name={icon} />
        </span>
      )}
      <span class="sb-starter-name">{name}</span>
      <span class="sb-starter-description">{description}</span>
    </button>
  );
}

export function StarterGallery({
  kits,
  onPick,
  showGit,
  selectedId,
}: StarterGalleryProps) {
  const marked = (id: string) =>
    selectedId === undefined ? undefined : selectedId === id;
  return (
    <div class="sb-starter-gallery">
      {kits.map((kit) => (
        <Card
          key={kit.id}
          name={kit.name}
          description={kit.description}
          previewUrl={kit.previewUrl}
          icon={kit.icon}
          selected={marked(kit.id)}
          onClick={() => onPick({ type: "kit", id: kit.id })}
        />
      ))}
      {showGit && (
        <Card
          name={GIT_NAME}
          description={GIT_DESCRIPTION}
          icon="git-branch"
          selected={marked("git")}
          onClick={() => onPick({ type: "git" })}
        />
      )}
    </div>
  );
}
