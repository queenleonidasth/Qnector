import { access } from "node:fs/promises";
import path from "node:path";
import type { QnectorConfig } from "@qnector/shared";
import { withWorkspace } from "./config.js";

export class WorkspaceState {
  private config: QnectorConfig;

  public constructor(config: QnectorConfig) {
    this.config = config;
  }

  public get value(): QnectorConfig {
    return this.config;
  }

  public replace(config: QnectorConfig): void {
    this.config = config;
  }

  public async set(workspace: string): Promise<QnectorConfig> {
    const absolute = path.resolve(workspace);
    await access(absolute);
    this.config = withWorkspace(this.config, absolute);
    return this.config;
  }

  public resolve(input?: string): string {
    if (!input || input.trim() === "") return this.config.activeWorkspace;
    return path.isAbsolute(input)
      ? path.normalize(input)
      : path.resolve(this.config.activeWorkspace, input);
  }

  public recent(): string[] {
    return [...this.config.recentWorkspaces];
  }
}
