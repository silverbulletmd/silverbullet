// Shared types for the index plug

export type AnchorHit = {
  page: string;
  hostTag: string;
};

export type ResolveAnchorResult =
  | { ok: true; page: string; hostTag: string; range: [number, number] }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "duplicate"; hits: AnchorHit[] };
