import { useEffect, useState } from "react";

/** The old ui.animationsEnabled=false remains an unconditional override. */
export type MotionQuality = "full" | "balanced" | "eco" | "off";
export type MotionEffectiveQuality = MotionQuality | "reduced";
export interface MotionBudget {
  ribbons: number;
  dust: number;
  orbArcs: number;
  orbPoints: number;
  maxDpr: number;
  moving: boolean;
}
export interface MotionTelemetry {
  fps: number;
  p95FrameMs: number;
  missed60HzFrames: number;
  sampleFrames: number;
}
const STORAGE = "qnector:motion-quality:v1";
const TELEMETRY_STORAGE = "qnector:motion-qc:v1";
export const MOTION_CHANGE_EVENT = "qnector:motion-policy-change";
export const MOTION_TELEMETRY_EVENT = "qnector:motion-telemetry";
export const QUALITY_OPTIONS: readonly MotionQuality[] = ["full", "balanced", "eco", "off"];
const budgets: Record<MotionEffectiveQuality, MotionBudget> = {
  full: { ribbons: 8, dust: 45, orbArcs: 10, orbPoints: 36, maxDpr: 1.75, moving: true },
  balanced: { ribbons: 6, dust: 30, orbArcs: 7, orbPoints: 24, maxDpr: 1.5, moving: true },
  eco: { ribbons: 3, dust: 12, orbArcs: 4, orbPoints: 12, maxDpr: 1, moving: true },
  off: { ribbons: 3, dust: 10, orbArcs: 5, orbPoints: 12, maxDpr: 1, moving: false },
  reduced: { ribbons: 3, dust: 10, orbArcs: 5, orbPoints: 12, maxDpr: 1, moving: false },
};
export function motionBudget(quality: MotionEffectiveQuality): MotionBudget {
  return budgets[quality];
}
export function parseMotionQuality(value: string | null | undefined): MotionQuality {
  return QUALITY_OPTIONS.includes(value as MotionQuality) ? value as MotionQuality : "balanced";
}
export function readMotionQuality(): MotionQuality {
  try { return parseMotionQuality(window.localStorage.getItem(STORAGE)); }
  catch { return "balanced"; }
}
export function readMotionTelemetryOptIn(): boolean {
  try { return window.localStorage.getItem(TELEMETRY_STORAGE) === "true"; }
  catch { return false; }
}
export function persistMotionQuality(quality: MotionQuality): void {
  try { window.localStorage.setItem(STORAGE,quality); }
  catch { /* file:// / privacy modes can deny writes; the UI still works. */ }
}
export function persistMotionTelemetryOptIn(enabled: boolean): void {
  try { window.localStorage.setItem(TELEMETRY_STORAGE, String(enabled)); }
  catch { /* Best effort; no remote telemetry or transmission. */ }
}
export function effectiveMotionQuality(
  quality: MotionQuality,
  legacyEnabled: boolean,
  reduceMotion: boolean,
): MotionEffectiveQuality {
  if (!legacyEnabled || quality === "off") return "off";
  return reduceMotion ? "reduced" : quality;
}
export function currentMotionQuality(): MotionEffectiveQuality {
  const name = document.documentElement.dataset.motionQuality;
  return name === "full" || name === "eco" || name === "off" || name === "reduced" ? name : "balanced";
}
export function useMotionPreferences(legacyEnabled: boolean): {
  quality: MotionQuality;
  setQuality: (next: MotionQuality) => void;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (enabled: boolean) => void;
  stats: MotionTelemetry | null;
  effective: MotionEffectiveQuality;
} {
  const [quality, updateQuality] = useState(readMotionQuality);
  const [telemetryEnabled, setTelemetry] = useState(readMotionTelemetryOptIn);
  const [reduce, setReduce] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [stats, setStats] = useState<MotionTelemetry | null>(null);
  const effective = effectiveMotionQuality(quality, legacyEnabled, reduce);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = (): void => setReduce(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change",change);
  },[]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motionQuality = effective;
    root.dataset.motionTelemetry = telemetryEnabled ? "on" : "off";
    root.dispatchEvent(new Event(MOTION_CHANGE_EVENT));
    return () => {
      delete root.dataset.motionQuality;
      delete root.dataset.motionTelemetry;
      root.dispatchEvent(new Event(MOTION_CHANGE_EVENT));
    };
  },[effective,telemetryEnabled]);
  useEffect(() => {
    if (!telemetryEnabled) { setStats(null); return; }
    const onStats = (event: Event): void => {
      const data = (event as CustomEvent<MotionTelemetry>).detail;
      if (data) setStats(data);
    };
    document.documentElement.addEventListener(MOTION_TELEMETRY_EVENT,onStats);
    return () => document.documentElement.removeEventListener(MOTION_TELEMETRY_EVENT,onStats);
  },[telemetryEnabled]);
  return {
    quality,
    effective,
    telemetryEnabled,
    stats,
    setQuality: next => {
      updateQuality(next);
      persistMotionQuality(next);
    },
    setTelemetryEnabled: enabled => {
      setTelemetry(enabled);
      persistMotionTelemetryOptIn(enabled);
    },
  };
}
