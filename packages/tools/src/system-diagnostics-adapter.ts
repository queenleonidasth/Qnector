import os from "node:os";
import { localMcpUrl } from "@qnector/shared";
import { getBuildIdentity, qnectorPerformance } from "@qnector/core";
import type { ToolContext } from "./tool-result.js";

/** In-process diagnostics adapter. The public MCP tool and result envelope remain unchanged. */
export async function executeSystemDiagnostics(
  context: ToolContext,
  action: string,
) {
  if (action === "info") {
    const config = context.getConfig();
    const build = await getBuildIdentity();
    return {
      summary: `System information for ${config.machineName}`,
      data: {
        os: `${os.type()} ${os.release()}`,
        platform: process.platform,
        architecture: process.arch,
        username: os.userInfo().username,
        hostname: os.hostname(),
        homeDirectory: os.homedir(),
        currentDirectory: process.cwd(),
        activeWorkspace: config.activeWorkspace,
        shell: config.shell.windows,
        nodeVersion: process.version,
        qnectorVersion: build.version,
        build,
        localMcpUrl: localMcpUrl(config.host, config.localPort),
        capabilities: context.platform?.capabilities() ?? {
          provider: "unsupported",
          clipboardText: false,
          toast: false,
          screenCapture: false,
          windowList: false,
          windowFocus: false,
        },
      },
    };
  }
  if (action === "status") {
    const config = context.getConfig();
    return {
      summary: "Qnector local status",
      data: {
        state: "connected",
        host: config.host,
        port: config.localPort,
        localUrl: localMcpUrl(config.host, config.localPort),
        activeWorkspace: config.activeWorkspace,
        transport: config.transport.mode,
        processCount: context.processManager
          .list()
          .filter((entry) => entry.state === "running").length,
      },
    };
  }
  if (action === "build_info") {
    const build = await getBuildIdentity();
    return {
      summary: `Qnector ${build.version} build ${build.buildId}`,
      data: build,
    };
  }
  if (action === "performance") {
    const snapshot = qnectorPerformance.snapshot();
    return {
      summary: `Performance snapshot: ${snapshot.milestones.length} milestone(s), ${snapshot.aggregates.length} operation group(s)`,
      data: snapshot,
    };
  }
  if (action === "release_status") {
    if (!context.releaseManager)
      throw new Error(
        "UNSUPPORTED_CAPABILITY: release manager is not configured in this Qnector runtime",
      );
    const result = await context.releaseManager.status(
      context.getConfig().activeWorkspace,
    );
    return {
      summary: `Qnector release status: ${result.status}`,
      data: result,
    };
  }
  throw new Error(`INVALID_ACTION: Unknown diagnostic action '${action}'`);
}
