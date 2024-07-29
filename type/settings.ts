import { ActionButton, EmojiConfig, Shortcut } from "$lib/web.ts";
import { Manifest } from "$lib/manifest.ts";
import { PageDecoration } from "$sb/types.ts";

export type ObjectDecorator = {
    // The expression to match against the object
    where: string;
    // The dynamic attributes to add to the object
    attributes: Record<string, string>; // attributePath -> expression
};

export type BuiltinSettings = {
    indexPage: string;
    shortcuts?: Shortcut[];
    useSmartQuotes?: boolean;
    maximumAttachmentSize?: number;
    // Open the last page that was open when the app was closed
    pwaOpenLastPage?: boolean;
    // UI visuals
    hideEditButton?: boolean;
    hideSyncButton?: boolean;
    actionButtons: ActionButton[];
    objectDecorators?: ObjectDecorator[];
    // Format: compatible with docker ignore
    spaceIgnore?: string;
    emoji?: EmojiConfig;
    // DEPRECATED: Use space styles instead
    customStyles?: string | string[];
    // DEPRECATED: Use shortcuts instead
    plugOverrides?: Record<string, Partial<Manifest>>;

    // NOTE: Bit niche, maybe delete at some point?
    defaultLinkStyle?: string;
};
