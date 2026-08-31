import path from "node:path";

/**
 * electron-builder's portable launcher extracts the app to a temporary
 * directory before starting it. The launcher path is exposed through this
 * environment variable and is the path Windows must use for auto-start.
 */
export const PORTABLE_EXECUTABLE_FILE = "PORTABLE_EXECUTABLE_FILE";

export const WINDOWS_LOGIN_ITEM_NAME = "app.qnector.desktop";
export const LEGACY_WINDOWS_LOGIN_ITEM_NAME = "electron.app.Qnector";

export interface WindowsLoginItemSettings {
  openAtLogin: boolean;
  path: string;
  args: string[];
  enabled: boolean;
  name: string;
}

export function resolveLoginExecutablePath(
  environment: NodeJS.ProcessEnv,
  fallbackPath: string,
): string {
  const portablePath = environment[PORTABLE_EXECUTABLE_FILE]?.trim();
  return path.resolve(portablePath || fallbackPath);
}

export function createWindowsLoginItemSettings(
  openAtLogin: boolean,
  environment: NodeJS.ProcessEnv,
  fallbackPath: string,
): WindowsLoginItemSettings {
  return {
    openAtLogin,
    path: resolveLoginExecutablePath(environment, fallbackPath),
    args: [],
    enabled: openAtLogin,
    name: WINDOWS_LOGIN_ITEM_NAME,
  };
}
