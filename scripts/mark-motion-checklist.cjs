"use strict";
/* Applies verified evidence to only the explicitly audited tasks. Run after QA. */
const fs=require("node:fs");
const path=require("node:path");
const root=process.cwd();
const file=path.join(root,"animation-rework.md");
const completed={
 "02":"royal-motion-keyframe-inventory.md and 90-reference source mapping",
 "03":"royal-motion-system.css token palette; state-contracts.md",
 "04":"royal-motion-state-contracts.md connection/drawer/setup/update diagrams",
 "06":"approved Queen Liquid Glass HTML V2.1 and user design feedback",
 "07":"motion-policy.ts and motion-policy.test.ts",
 "08":"motion-policy.ts, royal-motion-clock.ts, native controls and QA",
 "09":"royal-motion-system.css shared transitions for press/hover/enter/exit/status",
 "10":"40 rapid native route retargets; rAF pause/cancel cleanup",
 "11":"native window visibility/OS reduce/quality/old boolean-off tested",
 "12":"opt-in local-only native telemetry FPS/P95/missed frames",
 "13":"royal-silk-background.tsx replaces runtime Matrix, DPR and visibility QA",
 "14":"bounded Silk/caustic/particles and Queen Orb share one native rAF",
 "15":"Queen PNG in header, Liquid Glass top-level materials, native images",
 "16":"frameless sharp Queen Orb, Canvas flow and native Electron preview",
 "17":"native 3s hold/cancel/rejected backend and hidden idle ring QC",
 "19":"royal-icons.tsx and dock hover/press/selection/focus CSS",
 "20":"reversible drawer open/close and focus/Escape native QC",
 "21":"40 instant retargeted tab clicks without 200ms lock and scroll restore",
 "22":"shared modal/backdrop glass + existing keyboard/focus/click-outside QA",
 "24":"native multi-viewport drawer navigation, focus and scroll retention",
 "25":"central controls and removal of 8 transition:all declarations",
 "26":"synthetic 16-event native Activity virtualization layout QA",
 "43":"no new third-party runtime package; CSS, TS, Canvas and inline SVG only",
 "44":"royal-motion-state-contracts.md and royal-motion-v2-implementation-report.md"
};
const source=fs.readFileSync(file,"utf8");
let marked=0;
const next=source.split(/\r?\n/).map(line=>{
 const m=line.match(/^- \[ \] \*\*AR-(\d{2})\*\*/);
 if(!m||!(m[1] in completed))return line;
 if(!line.includes("**Evidence:** _pending_"))throw Error("Task evidence format changed: AR-"+m[1]);
 marked++;
 return line.replace("- [ ]","- [x]").replace("**Evidence:** _pending_","**Evidence:** "+completed[m[1]]);
}).join("\n");
const found=(next.match(/\*\*AR-\d{2}\*\*/g)||[]).length;
const checked=(next.match(/^- \[x\] \*\*AR-/gm)||[]).length;
const pending=(next.match(/^- \[ \] \*\*AR-/gm)||[]).length;
if(found!==48||marked!==Object.keys(completed).length||checked!==marked||pending!==48-marked)
 throw Error("Checklist invariant failed: "+JSON.stringify({found,marked,checked,pending}));
fs.writeFileSync(file,next,"utf8");
console.log(JSON.stringify({found,verifiedComplete:checked,remainingPending:pending}));
