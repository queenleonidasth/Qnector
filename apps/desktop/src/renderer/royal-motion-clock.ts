import { useEffect, useRef } from "react";
import {
  MOTION_CHANGE_EVENT,
  MOTION_TELEMETRY_EVENT,
  currentMotionQuality,
  motionBudget,
  type MotionTelemetry,
} from "./motion-policy.js";

/** A central, shared VSYNC clock for all continuously animated renderer Canvas. */
export const MIN_ACTIVE_MOTION_TARGET_FPS = 60;
export const RAF_CADENCE = "native-vsync" as const;
export type RoyalFramePainter = (timeSeconds: number, animated: boolean) => void;
interface Subscriber {
  paint: () => RoyalFramePainter;
  enabled: boolean;
}
const subscribers = new Set<Subscriber>();
let frame: number | null = null;
let visible = false;
let hasNativeVisibility = false;
let unsubscribeNative: (() => void) | null = null;
let media: MediaQueryList | null = null;
let lastFrame = 0;
let telemetryAt = 0;
let timings: number[] = [];

function isMoving(): boolean {
  return subscribers.size > 0 &&
    !document.hidden && visible &&
    !(media?.matches ?? false) &&
    document.documentElement.dataset.motion !== "off" &&
    motionBudget(currentMotionQuality()).moving &&
    [...subscribers].some(item => item.enabled);
}
function staticPaint(): void {
  for (const item of subscribers) item.paint()(performance.now() / 1000,false);
}
function stopLoop(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  lastFrame = 0;
  timings = [];
  telemetryAt = 0;
}
function emitStats(time: number): void {
  if (document.documentElement.dataset.motionTelemetry !== "on") return;
  if (!telemetryAt) { telemetryAt = time; return; }
  if (time - telemetryAt < 1000) return;
  const ordered = timings.slice().sort((a,b) => a-b);
  const sum = timings.reduce((a,b)=>a+b,0);
  const data: MotionTelemetry = {
    fps: sum ? Math.round(timings.length / (sum/1000)*10)/10 : 0,
    p95FrameMs: ordered.length ? Math.round(ordered[Math.floor((ordered.length-1)*0.95)]!*10)/10 : 0,
    missed60HzFrames: ordered.filter(t=>t>17.4).length,
    sampleFrames: timings.length,
  };
  document.documentElement.dispatchEvent(new CustomEvent(MOTION_TELEMETRY_EVENT,{detail:data}));
  timings = [];
  telemetryAt = time;
}
function tick(time: number): void {
  frame = null;
  if (!isMoving()) return;
  if (lastFrame) {
    const delta = time-lastFrame;
    if (document.documentElement.dataset.motionTelemetry === "on") timings.push(delta);
  }
  lastFrame = time;
  for (const item of subscribers) {
    if (item.enabled) item.paint()(time/1000,true);
  }
  emitStats(time);
  // Native refresh: do not force 30/42/60 Hz on a 120/144/165 Hz display.
  frame = requestAnimationFrame(tick);
}
function refresh(): void {
  stopLoop();
  // Never insert a static zero-phase frame during a live state transition.
  // Hold and disconnect retain their preceding compositor frame.
  if (isMoving()) frame = requestAnimationFrame(tick);
  else staticPaint();
}
function onNativeVisibility(next: boolean): void {
  hasNativeVisibility = true;
  visible = next;
  refresh();
}
function startSharedClock(): void {
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change",refresh);
  document.addEventListener("visibilitychange",refresh);
  document.documentElement.addEventListener(MOTION_CHANGE_EVENT,refresh);
  const unsubscribe = window.qnector.onWindowVisible(onNativeVisibility);
  unsubscribeNative = unsubscribe;
  void window.qnector.getWindowVisible()
    .then(value=>{if(!hasNativeVisibility)onNativeVisibility(value)})
    .catch(()=>undefined);
}
function stopSharedClock(): void {
  stopLoop();
  unsubscribeNative?.();
  unsubscribeNative=null;
  document.removeEventListener("visibilitychange",refresh);
  document.documentElement.removeEventListener(MOTION_CHANGE_EVENT,refresh);
  media?.removeEventListener("change",refresh);
  media=null;
  visible=false;
  hasNativeVisibility=false;
}
/**
 * One shared requestAnimationFrame and one visibility subscription, regardless
 * of whether both the background and the Orb are mounted. Restores a static
 * frame when animations are off, the OS requests reduced motion or the window
 * is hidden. The user's legacy animationsEnabled=false remains an override.
 */
export function useRoyalCanvasMotion(paint: RoyalFramePainter, motionEnabled: boolean): void {
  const ref = useRef(paint);
  ref.current = paint;
  useEffect(()=>{
    const item: Subscriber = {paint:()=>ref.current, enabled:motionEnabled};
    const first=subscribers.size===0;
    subscribers.add(item);
    if(first) startSharedClock();
    refresh();
    return ()=>{
      subscribers.delete(item);
      if(subscribers.size===0)stopSharedClock();
      else refresh();
    };
  },[motionEnabled]);
}
