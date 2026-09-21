import type { SocialConfig } from "@qnector/shared";

export type SocialPlatform = "youtube" | "facebook";
export type SocialOperation =
  "health" | "capabilities" | "read" | "search" | "feed" | "profile";
export type SocialCompleteness = "FULL" | "PARTIAL" | "METADATA_ONLY";
export interface SocialItem {
  url: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  excerpt?: string;
  transcript?: string;
  transcriptSource?: "manual" | "automatic";
  transcriptLanguage?: "th" | "en";
}
export interface SocialData {
  summary: string;
  platform?: SocialPlatform;
  operation: SocialOperation;
  backend?: string;
  status: "ready" | "disabled" | "not_installed" | "auth_required" | "limited";
  items: SocialItem[];
  sourceUrl?: string;
  retrievedAt: string;
  completeness: SocialCompleteness;
  warnings: string[];
  nextCursor: null;
  capabilities?: Record<string, boolean>;
}
export interface SocialRequest {
  action: SocialOperation;
  platform?: SocialPlatform;
  url?: string;
  query?: string;
  limit?: number;
}
export type SocialEnvironment = Pick<
  SocialConfig,
  | "enabled"
  | "platforms"
  | "agentReachPath"
  | "youtubePath"
  | "opencliPath"
  | "nodePath"
  | "authMode"
  | "timeoutMs"
>;
