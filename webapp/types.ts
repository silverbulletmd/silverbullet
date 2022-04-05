import { AppCommand } from "./hooks/command";
import { PageMeta } from "../common/types";

export const slashCommandRegexp = /\/[\w\-]*/;

export type Notification = {
  id: number;
  message: string;
  date: Date;
};

export type AppViewState = {
  currentPage?: string;
  showPageNavigator: boolean;
  showCommandPalette: boolean;
  unsavedChanges: boolean;
  showLHS: number; // 0 = hide, > 0 = flex
  showRHS: number; // 0 = hide, > 0 = flex
  rhsHTML: string;
  lhsHTML: string;
  allPages: Set<PageMeta>;
  commands: Map<string, AppCommand>;
  notifications: Notification[];
};

export const initialViewState: AppViewState = {
  showPageNavigator: false,
  showCommandPalette: false,
  unsavedChanges: false,
  showLHS: 0,
  showRHS: 0,
  rhsHTML: "",
  lhsHTML: "",
  allPages: new Set(),
  commands: new Map(),
  notifications: [],
};

export type Action =
  | { type: "page-loaded"; name: string }
  | { type: "pages-listed"; pages: Set<PageMeta> }
  | { type: "page-changed" }
  | { type: "page-saved" }
  | { type: "start-navigate" }
  | { type: "stop-navigate" }
  | { type: "update-commands"; commands: Map<string, AppCommand> }
  | { type: "show-palette" }
  | { type: "hide-palette" }
  | { type: "show-notification"; notification: Notification }
  | { type: "dismiss-notification"; id: number }
  | { type: "show-rhs"; html: string; flex: number }
  | { type: "hide-rhs" }
  | { type: "show-lhs"; html: string; flex: number }
  | { type: "hide-lhs" };
