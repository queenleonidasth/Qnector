import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentSkillService } from "./agent-skills.js";

const skillsRoot = fileURLToPath(new URL("../../../skills", import.meta.url));

type GoldenCase = {
  prompt: string;
  include: string[];
  exclude?: string[];
};

const cases: GoldenCase[] = [
  {
    prompt: "ออกแบบหน้า login ให้สวยและใช้งานง่าย",
    include: ["ui-ux-design"],
    exclude: ["archive-workflows", "spreadsheet-workflows"],
  },
  {
    prompt: "redesign this settings UI with better hierarchy",
    include: ["ui-ux-design"],
  },
  {
    prompt: "make the dashboard responsive and visually polished",
    include: ["ui-ux-design"],
  },
  { prompt: "ปรับหน้าตาเว็บให้ดู premium ขึ้น", include: ["ui-ux-design"] },
  { prompt: "fix the frontend layout and styling", include: ["ui-ux-design"] },

  {
    prompt: "add a beautiful interactive background animation to this UI",
    include: ["ui-ux-design", "loading-motion-design"],
  },
  {
    prompt: "อยากได้แอนิเมชันหน้าเว็บแบบ interact และลื่น",
    include: ["ui-ux-design", "loading-motion-design"],
  },
  {
    prompt: "มันดูไม่สวย อยากได้ animation สวยๆแบบ interact ได้",
    include: ["ui-ux-design", "loading-motion-design", "ui-ux-audit"],
    exclude: ["archive-workflows"],
  },
  {
    prompt: "add parallax and transition motion to the login page",
    include: ["ui-ux-design", "loading-motion-design"],
  },
  {
    prompt: "ทำ background animation แบบล้ำๆให้หน้า login",
    include: ["ui-ux-design", "loading-motion-design"],
  },

  {
    prompt: "audit this UI for clipping scroll and accessibility issues",
    include: ["ui-ux-audit"],
  },
  {
    prompt: "เช็ค UI ว่ามีอะไรเพี้ยน ใช้งานยาก หรือ scroll ไม่ได้",
    include: ["ui-ux-audit"],
  },
  {
    prompt: "QC หน้า dashboard เรื่อง layout และ responsive",
    include: ["ui-ux-audit"],
  },
  { prompt: "ตรวจ UX UI ของหน้า settings ให้หน่อย", include: ["ui-ux-audit"] },
  {
    prompt: "find visual bugs in this existing interface",
    include: ["ui-ux-audit"],
  },

  {
    prompt: "เปิดไฟล์ xlsx แล้วแก้สูตรใน workbook",
    include: ["spreadsheet-workflows"],
    exclude: ["ui-ux-design", "archive-workflows"],
  },
  {
    prompt: "clean this Excel spreadsheet and preserve formulas",
    include: ["spreadsheet-workflows"],
  },
  {
    prompt: "compare two CSV files and create a clean XLSX",
    include: ["spreadsheet-workflows"],
  },
  {
    prompt: "จัดข้อมูลในชีตและตรวจสูตร excel",
    include: ["spreadsheet-workflows"],
  },
  {
    prompt: "analyze workbook sheets and formulas",
    include: ["spreadsheet-workflows"],
  },

  {
    prompt: "แตกไฟล์ zip นี้แล้วตรวจข้างใน",
    include: ["archive-workflows"],
    exclude: ["ui-ux-design"],
  },
  {
    prompt: "create a 7z archive from this folder",
    include: ["archive-workflows"],
  },
  { prompt: "extract this RAR safely", include: ["archive-workflows"] },
  { prompt: "บีบอัดโฟลเดอร์เป็น zip", include: ["archive-workflows"] },
  {
    prompt: "compare the contents of two archives",
    include: ["archive-workflows"],
  },

  {
    prompt: "อ่าน PDF นี้แล้วสรุปและ QC เอกสาร",
    include: ["document-workflows"],
  },
  {
    prompt: "edit this DOCX while preserving structure",
    include: ["document-workflows"],
  },
  {
    prompt: "convert the PPTX document and inspect output",
    include: ["document-workflows"],
  },
  { prompt: "ช่วยอ่านเอกสาร Word ไฟล์นี้", include: ["document-workflows"] },
  {
    prompt: "inspect this document file for formatting issues",
    include: ["document-workflows"],
  },

  {
    prompt: "QC โปรเจกต์ก่อน release รัน test lint build ให้ครบ",
    include: ["project-qc"],
    exclude: ["spreadsheet-workflows"],
  },
  {
    prompt: "validate this repository before shipping",
    include: ["project-qc"],
  },
  { prompt: "เช็คโปรเจกต์ว่าผ่าน test และ build ไหม", include: ["project-qc"] },
  {
    prompt: "run the release gate and report regressions",
    include: ["project-qc"],
  },
  {
    prompt: "stabilize this project and verify all checks",
    include: ["project-qc"],
  },

  {
    prompt: "ปรับ Skill Router และ Test Trigger ให้แม่นขึ้น",
    include: ["skill-authoring"],
  },
  {
    prompt: "improve Agent Skill routing metadata",
    include: ["skill-authoring"],
  },
  {
    prompt: "create a reusable SKILL.md for browser workflows",
    include: ["skill-authoring"],
  },
  {
    prompt: "review this agent skill trigger description",
    include: ["skill-authoring"],
  },
  {
    prompt: "แก้ skill routing ไม่ให้ match มั่ว",
    include: ["skill-authoring"],
  },

  {
    prompt: "fix this TypeScript typecheck error",
    include: ["typescript-best-practices"],
  },
  {
    prompt: "review these TS generics and type safety",
    include: ["typescript-best-practices"],
  },
  {
    prompt: "refactor this .tsx module with safer types",
    include: ["typescript-best-practices"],
  },
  {
    prompt: "แก้ TypeScript types ในโปรเจกต์นี้",
    include: ["typescript-best-practices"],
  },
  {
    prompt: "check tsconfig and strict typing",
    include: ["typescript-best-practices"],
  },

  {
    prompt: "fix Electron IPC and contextBridge security",
    include: ["electron-best-practices"],
  },
  {
    prompt: "package this Electron desktop app correctly",
    include: ["electron-best-practices"],
  },
  {
    prompt: "review Electron main renderer IPC architecture",
    include: ["electron-best-practices"],
  },
  {
    prompt: "แก้ปัญหา Electron app ตอน startup",
    include: ["electron-best-practices"],
  },
  {
    prompt: "improve code signing for the Electron build",
    include: ["electron-best-practices"],
  },

  {
    prompt: "create a design system with tokens typography and spacing",
    include: ["design-system"],
  },
  {
    prompt: "ทำระบบดีไซน์และ theme tokens ให้ทั้งแอพ",
    include: ["design-system"],
  },
  {
    prompt: "normalize component colors into design tokens",
    include: ["design-system"],
  },
  {
    prompt: "extract typography and spacing into a design system",
    include: ["design-system"],
  },
  {
    prompt: "extend our theme tokens consistently",
    include: ["design-system"],
  },

  {
    prompt: "rewrite the button labels and error microcopy",
    include: ["ux-writing"],
  },
  {
    prompt: "ปรับข้อความใน UI และชื่อปุ่มให้เข้าใจง่าย",
    include: ["ux-writing"],
  },
  { prompt: "audit UX writing for onboarding errors", include: ["ux-writing"] },
  {
    prompt: "improve microcopy in empty and loading states",
    include: ["ux-writing"],
  },
  {
    prompt: "fix wording for form validation messages",
    include: ["ux-writing"],
  },

  {
    prompt: "design the architecture for this backend system",
    include: ["system-design"],
    exclude: ["ui-ux-design"],
  },
  { prompt: "ออกแบบระบบและตัดสินใจ architecture", include: ["system-design"] },
  {
    prompt: "review service boundaries and architecture tradeoffs",
    include: ["system-design"],
  },
  {
    prompt: "choose a practical system design for a solo developer",
    include: ["system-design"],
  },
  { prompt: "วาง architecture ของระบบนี้", include: ["system-design"] },

  {
    prompt: "design a fast startup splash transition",
    include: ["loading-motion-design"],
  },
  {
    prompt: "ปรับ animation ตอนเปิดโปรแกรมให้ smooth",
    include: ["loading-motion-design"],
  },
  {
    prompt: "fix skeleton loading and perceived lag",
    include: ["loading-motion-design"],
  },
  {
    prompt: "add a determinate loading progress state",
    include: ["loading-motion-design"],
  },
  {
    prompt: "make the page transition smooth without blocking input",
    include: ["loading-motion-design"],
  },
];

describe("Agent Skill golden routing", () => {
  const service = new AgentSkillService({
    roots: [{ path: skillsRoot, source: "bundled" }],
  });

  it(`covers ${cases.length} representative Thai/English/mixed routing prompts`, async () => {
    const failures: string[] = [];
    for (const golden of cases) {
      const plan = await service.plan(golden.prompt, 5, 8);
      const selected = plan.selected.map((skill) => skill.name);
      for (const expected of golden.include) {
        if (!selected.includes(expected))
          failures.push(
            `${golden.prompt} -> missing ${expected}; got ${selected.join(", ") || "none"}`,
          );
      }
      for (const forbidden of golden.exclude ?? []) {
        if (selected.includes(forbidden))
          failures.push(
            `${golden.prompt} -> unexpectedly selected ${forbidden}; got ${selected.join(", ")}`,
          );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
