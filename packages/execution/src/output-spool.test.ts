import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { OutputSpool } from "./output-spool.js";
const roots: string[] = [];
function fixture(cap = 1024) {
  const root = mkdtempSync(path.join(tmpdir(),"qnector-spool-"));
  roots.push(root);
  const id = `attempt_${randomUUID()}`;
  return {root,id,spool:new OutputSpool(root,id,cap)};
}
afterEach(() => {for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true});});

describe("Durable output spool (P1)",() => {
  it("reads independent byte cursors and does not split UTF-8 across pages",() => {
    const {spool} = fixture();
    spool.append("stdout",Buffer.from("A😀B"));
    spool.append("stderr",Buffer.from("warning"));
    expect(spool.page("stdout",0,4)).toMatchObject({text:"A",nextCursor:1,complete:false});
    expect(spool.page("stdout",1,4)).toMatchObject({text:"😀",nextCursor:5});
    expect(spool.page("stdout",5,4)).toMatchObject({text:"B",nextCursor:6});
    expect(spool.page("stderr",0,10).text).toBe("warning");
    const {manifest} = spool.finalize(0,null);
    expect(manifest).toMatchObject({exitCode:0,stdoutBytes:6,stderrBytes:7,outputState:"complete"});
    expect(spool.page("stdout",6,4).complete).toBe(true);
    expect(() => spool.append("stdout",Buffer.from("again"))).toThrow("OUTPUT_FINALIZED");
  });

  it("bounds spool bytes, records partial output and survives recreation",() => {
    const {root,id,spool} = fixture(5);
    spool.append("stdout",Buffer.from("1234"));
    spool.append("stderr",Buffer.from("ABCDEFG"));
    const result = spool.finalize(1,null);
    expect(result.manifest).toMatchObject({stdoutBytes:4,stderrBytes:1,droppedBytes:6,outputState:"partial"});
    expect(readFileSync(result.path,"utf8")).toContain('"outputState":"partial"');
    const reopen = new OutputSpool(root,id,5);
    expect(reopen.manifest()).toEqual(result.manifest);
    expect(reopen.page("stdout",0,4).truncated).toBe(true);
    expect(reopen.page("stderr",0,4)).toMatchObject({text:"A",complete:true});
    expect(() => reopen.page("stdout",99)).toThrow("OUTPUT_CURSOR_INVALID");
  });

  it("rejects traversal IDs and duplicate completion",() => {
    const {root,spool} = fixture();
    expect(() => new OutputSpool(root,"../../etc")).toThrow("INVALID_INPUT");
    spool.finalize(null,"SIGTERM");
    expect(() => spool.finalize(null,null)).toThrow("OUTPUT_FINALIZED");
  });
});
