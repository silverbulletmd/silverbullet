/** Wire types for starter kits, shared by Server and Desktop. */

export type InterfaceLevel = "minimal" | "standard";

/** A bundled starter kit, as `starter_kits::list` returns it. */
export type KitInfo = {
  id: string;
  name: string;
  description: string;
  order: number;
  interface: InterfaceLevel;
  hasPreview: boolean;
};

/** A kit ready for the gallery, with its preview resolved by the host. */
export type PickableKit = KitInfo & { previewUrl?: string };

/** What a create request asks to seed the new space with. */
export type Starter =
  | { type: "kit"; id: string; interface?: InterfaceLevel }
  | { type: "git"; url: string }
  | { type: "none" };

export type StarterContent = "applied" | "skipped" | "none" | "failed";

/** The `starterContent` / `starterError` fields of a create response. */
export type StarterOutcome = {
  starterContent?: StarterContent;
  starterError?: string;
};
