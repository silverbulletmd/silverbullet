/** Lucide's icon format: the child elements of a 24×24 stroke `<svg>`. */
export type IconNode = [tag: string, attrs: Record<string, string | number>][];

export type IconData = {
  icons: Record<string, IconNode>;
  /** Alternative name → canonical Lucide name */
  aliases: Record<string, string>;
};

/** Canonical name → search keywords */
export type IconKeywords = Record<string, string[]>;
