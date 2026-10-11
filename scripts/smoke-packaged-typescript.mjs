import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[2] === "--probe") {
  const resources = process.resourcesPath;
  const workspace = process.env.QNECTOR_SMOKE_SOURCE_WORKSPACE || repo;
  if (!resources) throw new Error("PACKAGED_RESOURCES_PATH_MISSING");
  const modulePath = path.join(
    resources, "app.asar", "node_modules", "@qnector", "core", "dist", "code-intelligence.js"
  );
  if (!existsSync(modulePath)) throw new Error("PACKAGED_CODE_INTELLIGENCE_MISSING");
  const { TypeScriptCodeIntelligence } = await import(pathToFileURL(modulePath).href);
  const service = new TypeScriptCodeIntelligence();
  const diagnostics = await service.diagnostics({
    workspaceRoot: workspace,
    path: "packages/core/src/plan-act-store.ts",
    tsconfig: "packages/core/tsconfig.json",
    maxResults: 6,
  });
  if (diagnostics.total !== 0)
    throw new Error(
      "PACKAGED_TYPESCRIPT_FALSE_DIAGNOSTICS: " +
        JSON.stringify({ total: diagnostics.total, sample: diagnostics.diagnostics })
    );
  const symbols = await service.documentSymbols({
    workspaceRoot: workspace,
    path: "packages/core/src/plan-act-store.ts",
    tsconfig: "packages/core/tsconfig.json",
    maxResults: 6,
  });
  if (!symbols.total) throw new Error("PACKAGED_TYPESCRIPT_NO_SYMBOLS");
  console.log("PACKAGED_TYPESCRIPT_DIAGNOSTICS_PASSED");
} else {
  const executable = process.env.QNECTOR_SMOKE_EXECUTABLE;
  if (!executable || !existsSync(executable))
    throw new Error("PACKAGED_TYPESCRIPT_EXECUTABLE_MISSING");
  const result = spawnSync(executable, [fileURLToPath(import.meta.url), "--probe"], {
    cwd: repo,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", QNECTOR_SMOKE_SOURCE_WORKSPACE: repo },
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 2_000_000,
  });
  if (result.error || result.status !== 0 || !result.stdout.includes("PACKAGED_TYPESCRIPT_DIAGNOSTICS_PASSED"))
    throw new Error(
      "PACKAGED_TYPESCRIPT_DIAGNOSTICS_FAILED: " + (result.error?.message || result.status) +
      "\n" + result.stdout.slice(-2500) + "\n" + result.stderr.slice(-1200)
    );
  console.log("PACKAGED_TYPESCRIPT_DIAGNOSTICS_PASSED");
}
