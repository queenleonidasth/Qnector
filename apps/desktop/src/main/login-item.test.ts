import { describe, expect, it } from "vitest";
import {
  createWindowsLoginItemSettings,
  resolveLoginExecutablePath,
  WINDOWS_LOGIN_ITEM_NAME,
} from "./login-item.js";

describe("Windows login item settings", () => {
  it("uses the portable launcher instead of the extracted child executable", () => {
    const settings = createWindowsLoginItemSettings(
      true,
      { PORTABLE_EXECUTABLE_FILE: "C:\\Apps\\Qnector\\Qnector.exe" },
      "C:\\Users\\QUEEN\\AppData\\Local\\Temp\\extracted\\Qnector.exe",
    );

    expect(settings).toEqual({
      openAtLogin: true,
      path: "C:\\Apps\\Qnector\\Qnector.exe",
      args: [],
      enabled: true,
      name: WINDOWS_LOGIN_ITEM_NAME,
    });
  });

  it("falls back to Electron's executable for installed builds", () => {
    expect(
      resolveLoginExecutablePath({}, "C:\\Program Files\\Qnector\\Qnector.exe"),
    ).toBe("C:\\Program Files\\Qnector\\Qnector.exe");
  });

  it("removes the login item when the setting is disabled", () => {
    const settings = createWindowsLoginItemSettings(
      false,
      {},
      "C:\\Program Files\\Qnector\\Qnector.exe",
    );

    expect(settings.openAtLogin).toBe(false);
    expect(settings.enabled).toBe(false);
  });
});
