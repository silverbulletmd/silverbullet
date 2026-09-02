export type ConfiguredActionButton = {
  icon: string;
  description?: string;
  command?: string;
  mobile?: boolean;
  standalone?: boolean;
  /** Render only where `BootConfig.accountManaged` matches this value. */
  accountManaged?: boolean;
  dropdown?: boolean;
  priority?: number;
  run?: () => void;
};

export type ActionButtonContext = {
  isMobile: boolean;
  isStandalone: boolean;
  accountManaged: boolean;
};

const matches = (want: boolean | undefined, actual: boolean) =>
  typeof want === "undefined" || want === actual;

export function visibleActionButtons(
  buttons: ConfiguredActionButton[],
  ctx: ActionButtonContext,
): (ConfiguredActionButton & { priority: number })[] {
  return buttons
    .filter(
      (button) =>
        button.icon &&
        matches(button.mobile, ctx.isMobile) &&
        matches(button.standalone, ctx.isStandalone) &&
        matches(button.accountManaged, ctx.accountManaged),
    )
    .map((button, index) => ({
      ...button,
      priority: button.priority ?? buttons.length - index,
    }))
    .sort((a, b) => b.priority - a.priority);
}
