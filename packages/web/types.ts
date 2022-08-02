import { AppCommand, CommandDef } from "./hooks/command";
import { FilterOption, PageMeta } from "@silverbulletmd/common/types";

export type Notification = {
  id: number;
  message: string;
  type: "info" | "error";
  date: Date;
};

export type AppViewState = {
  currentPage?: string;
  perm: "ro" | "rw";

  showPageNavigator: boolean;
  showCommandPalette: boolean;
  unsavedChanges: boolean;
  showLHS: number; // 0 = hide, > 0 = flex
  showRHS: number; // 0 = hide, > 0 = flex
  showBHS: number;
  rhsHTML: string;
  lhsHTML: string;
  bhsHTML: string;
  rhsScript?: string;
  lhsScript?: string;
  bhsScript?: string;
  allPages: Set<PageMeta>;
  commands: Map<string, AppCommand>;
  notifications: Notification[];
  recentCommands: Map<string, Date>;

  showFilterBox: boolean;
  filterBoxLabel: string;
  filterBoxPlaceHolder: string;
  filterBoxOptions: FilterOption[];
  filterBoxHelpText: string;
  filterBoxOnSelect: (option: FilterOption | undefined) => void;
};

export const initialViewState: AppViewState = {
  perm: "rw",
  showPageNavigator: false,
  showCommandPalette: false,
  unsavedChanges: false,
  showLHS: 0,
  showRHS: 0,
  showBHS: 0,
  rhsHTML: "",
  lhsHTML: "",
  bhsHTML: "",
  allPages: new Set(),
  commands: new Map(),
  recentCommands: new Map(),
  notifications: [],
  showFilterBox: false,
  filterBoxHelpText: "",
  filterBoxLabel: "",
  filterBoxOnSelect: () => {},
  filterBoxOptions: [],
  filterBoxPlaceHolder: "",
};

export type Action =
  | { type: "page-loaded"; meta: PageMeta }
  | { type: "pages-listed"; pages: Set<PageMeta> }
  | { type: "page-changed" }
  | { type: "page-saved" }
  | { type: "start-navigate" }
  | { type: "stop-navigate" }
  | {
      type: "update-commands";
      commands: Map<string, AppCommand>;
    }
  | { type: "show-palette"; context?: string }
  | { type: "hide-palette" }
  | { type: "show-notification"; notification: Notification }
  | { type: "dismiss-notification"; id: number }
  | { type: "show-rhs"; html: string; flex: number; script?: string }
  | { type: "hide-rhs" }
  | { type: "show-lhs"; html: string; flex: number; script?: string }
  | { type: "hide-lhs" }
  | { type: "show-bhs"; html: string; flex: number; script?: string }
  | { type: "hide-bhs" }
  | { type: "command-run"; command: string }
  | {
      type: "show-filterbox";
      options: FilterOption[];
      placeHolder: string;
      helpText: string;
      label: string;
      onSelect: (option: FilterOption | undefined) => void;
    }
  | { type: "hide-filterbox" };
