import type { ThemeInfo } from "../lib/themes.ts";
import { syscall } from "../syscall.ts";

/**
 * Inspect and switch the SilverBullet theme.
 * @module
 */

/**
 * Lists all installed themes.
 * @returns the themes, each with its page name, display name and light/dark scheme
 */
export function list(): Promise<ThemeInfo[]> {
  return syscall("theme.list");
}

/**
 * Gets the theme currently on screen.
 * @returns the active theme
 */
export function getActive(): Promise<ThemeInfo> {
  return syscall("theme.getActive");
}

/**
 * Gets this device's theme override.
 * @returns the page name of the override, or undefined when there is none
 */
export function getDeviceTheme(): Promise<string | undefined> {
  return syscall("theme.getDeviceTheme");
}

/**
 * Overrides the theme on this device only and applies it immediately.
 * @param page the theme's page name, or undefined to clear the override
 * @throws when no installed theme has that page name
 */
export function setDeviceTheme(page?: string): Promise<void> {
  return syscall("theme.setDeviceTheme", page);
}
