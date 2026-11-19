import type { GalleryChoice, Starter } from "@silverbulletmd/silverbullet/ui";
import { starterFor } from "./starter_kits.ts";
import type { SpaceInfo } from "./types.ts";

export type CreateChoices = {
  choice?: GalleryChoice;
  gitMode: "copy" | "sync";
  gitUrl: string;
  hasNotes: boolean;
};

export type CreatePayload = Partial<SpaceInfo> & {
  starter?: Starter;
};

/** The body of `POST /spaces`. */
export function createPayload(
  values: Partial<SpaceInfo>,
  { choice, gitMode, gitUrl, hasNotes }: CreateChoices,
): CreatePayload {
  if (!choice) return values;
  const kitOverNotes = choice.type === "kit" && hasNotes;
  return {
    ...values,
    starter: kitOverNotes
      ? { type: "none" }
      : starterFor(choice, gitMode, gitUrl),
  };
}
