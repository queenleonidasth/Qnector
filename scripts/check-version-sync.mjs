import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Keep the version advertised over MCP in sync with the packaged app version. */
export function checkVersionSync(projectRoot = defaultRoot) {
  const rootPackage = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
  const desktopPackage = JSON.parse(
    readFileSync(path.join(projectRoot, "apps/desktop/package.json"), "utf8"),
  );
  const config = readFileSync(
    path.join(projectRoot, "packages/core/src/config.ts"),
    "utf8",
  );
  const declaredVersion = config.match(
    /^export const QNECTOR_VERSION = "([^"]+)";\s*$/m,
  )?.[1];
  if (
    !declaredVersion ||
    rootPackage.version !== desktopPackage.version ||
    rootPackage.version !== declaredVersion
  ) {
    throw new Error(
      `Qnector version mismatch: root=${rootPackage.version ?? "missing"}, ` +
        `desktop=${desktopPackage.version ?? "missing"}, ` +
        `MCP=${declaredVersion ?? "missing"}. Update all three before building.`,
    );
  }
  return declaredVersion;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(`Qnector version sync OK: ${checkVersionSync()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
