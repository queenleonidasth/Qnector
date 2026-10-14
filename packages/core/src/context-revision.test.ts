import { describe, expect, it } from "vitest";
import { computeContextRevision } from "./context-revision.js";

const ref = {workspaceId:"w", taskId:"t", revision:"r1"};
describe("full context revisions", () => {
  it("tail_change_after_330_chars_changes_revision", () => {
    const a = {criticalContext:"ก".repeat(330)+"หนึ่ง"};
    const b = {criticalContext:"ก".repeat(330)+"สอง"};
    expect(computeContextRevision(ref,a)).not.toBe(computeContextRevision(ref,b));
  });
  it("status_change_changes_revision", () => {
    expect(computeContextRevision(ref,{status:"active"})).not.toBe(computeContextRevision(ref,{status:"blocked"}));
  });
  it("same_text_different_task_not_same_delta", () => {
    expect(computeContextRevision(ref,{text:"same"})).not.toBe(computeContextRevision({...ref,taskId:"other"},{text:"same"}));
  });
  it("hashes objects canonically and preserves Thai Unicode", () => {
    expect(computeContextRevision(ref,{b:2,a:"ภาษาไทย"})).toBe(computeContextRevision(ref,{a:"ภาษาไทย",b:2}));
  });
});
