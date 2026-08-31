export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type DesktopUpdateMode = "development" | "portable" | "installed";

export interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  mode: DesktopUpdateMode;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  publishedAt?: string;
  notes?: string;
  assetName?: string;
  progress?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  canDownload: boolean;
  canInstall: boolean;
  message?: string;
}
