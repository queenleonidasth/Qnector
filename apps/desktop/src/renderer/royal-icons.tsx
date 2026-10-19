import React from "react";

export type RoyalIconName =
  | "workspace" | "memory" | "skills" | "settings"
  | "runtime" | "folder" | "copy" | "connect" | "close";

/** Coherent, low-cost inline vector symbols; no emoji fallback, no icon pack. */
export function RoyalIcon({
  name,
  size = 18,
}: {
  name: RoyalIconName;
  size?: number;
}): React.ReactElement {
  const nodes: Record<RoyalIconName, React.ReactNode> = {
    workspace: <><rect x="3" y="3" width="7" height="7" rx="1.7"/><rect x="14" y="3" width="7" height="7" rx="1.7"/><rect x="3" y="14" width="7" height="7" rx="1.7"/><rect x="14" y="14" width="7" height="7" rx="1.7"/></>,
    memory: <><path d="M11 5a4 4 0 0 0-7 2 4 4 0 0 0-1 6 4 4 0 0 0 3 6 4 4 0 0 0 5-2V5Zm2 0a4 4 0 0 1 7 2 4 4 0 0 1 1 6 4 4 0 0 1-3 6 4 4 0 0 1-5-2V5Z"/><path d="M7 10h2m6 0h2M8 15h1m6 0h1"/></>,
    skills: <><path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7L12 2Z"/></>,
    settings: <><circle cx="12" cy="12" r="3.25"/><path d="M11 2h2l.7 2.4 2.1.8 2.2-1.1 1.5 1.5-1.1 2.1.9 2.2L22 11v2l-2.7.7-.9 2.1 1.1 2.2-1.5 1.5-2.2-1.1-2.1.9L13 22h-2l-.7-2.7-2.2-.9-2.1 1.1-1.5-1.5 1.1-2.2-.8-2.1L2 13v-2l2.4-.7.8-2.2-1.1-2.1 1.5-1.5 2.1 1.1 2.2-.8L11 2Z"/></>,
    runtime: <><path d="M2 12h4l3-7 5 14 3-7h5"/></>,
    folder: <><path d="M3 6h7l2 3h9v11H3V6Z"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    connect: <><circle cx="12" cy="12" r="9"/><path d="M8 12h8m-4-4 4 4-4 4"/></>,
    close: <><path d="M5 5l14 14M19 5 5 19"/></>,
  };
  return (
    <svg className="royal-inline-icon" width={size} height={size} viewBox="0 0 24 24"
      aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {nodes[name]}
    </svg>
  );
}
