import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { GenericLspService } from "./generic-lsp.js";

const active: Array<{ root: string; service: GenericLspService }> = [];
afterEach(async () => {
  for (const {root,service} of active.splice(0)) {
    if ("close" in service && typeof service.close === "function") await service.close();
    await rm(root, {recursive:true,force:true});
  }
});

async function fixture(service = new GenericLspService()){
  const root=await mkdtemp(path.join(tmpdir(),"qnector-generic-lsp-reuse-"));
  const source=path.join(root,"sample.py");
  await writeFile(source,"initial value\n");
  active.push({root,service});
  const request=()=>service.request({
    workspaceRoot:root,path:source,action:"document_symbols",
    serverCommand:process.execPath,
    serverArgs:[path.join(import.meta.dirname,"fixtures","fake-lsp-server.mjs")],
  });
  const read=async()=>{
    const output=await request();
    const symbols=output.result as Array<{name:string,detail:string}>;
    expect(symbols).toHaveLength(1);
    return {text:symbols[0]!.name,...JSON.parse(symbols[0]!.detail) as {
      pid:number;opens:number;changes:number;version:number;
    }};
  };
  return {root,source,service,read};
}

it("reuses the on-demand language server and sends a content revision instead of reopening the document", async () => {
  const {source,read}=await fixture();
  const initial=await read();
  const again=await read();
  expect(again.pid).toBe(initial.pid);
  expect(again.opens).toBe(1);
  expect(again.changes).toBe(0);
  await writeFile(source,"second value ภาษาไทย\n");
  const updated=await read();
  expect(updated.pid).toBe(initial.pid);
  expect(updated.text).toBe("second value ภาษาไทย\n");
  expect(updated.version).toBe(2);
  expect(updated.opens).toBe(1);
  expect(updated.changes).toBe(1);
}, 30000);

it("singleflights concurrent requests and isolates separate workspaces", async () => {
  const first=await fixture();
  const second=await fixture();
  const results=await Promise.all([first.read(),first.read(),first.read()]);
  expect(new Set(results.map(x=>x.pid)).size).toBe(1);
  expect(results.every(x=>x.opens===1)).toBe(true);
  expect((await second.read()).pid).not.toBe(results[0]!.pid);
}, 30000);

it("expires idle sessions and opens a new language server without serving stale document state", async () => {
  const item=await fixture(new GenericLspService({idleMs:100}));
  const first=await item.read();
  await new Promise(resolve=>setTimeout(resolve,450));
  await writeFile(item.source,"content after idle eviction\n");
  const second=await item.read();
  expect(second.pid).not.toBe(first.pid);
  expect(second.text).toBe("content after idle eviction\n");
  expect(second.opens).toBe(1);
  expect(second.version).toBe(1);
},30000);

it("caps persistent sessions and evicts an idle workspace before admitting another", async () => {
  const service = new GenericLspService({maxSessions:1});
  const first=await fixture(service);
  const second=await fixture(service);
  const before=await first.read();
  const other=await second.read();
  const after=await first.read();
  expect(other.pid).not.toBe(before.pid);
  expect(after.pid).not.toBe(before.pid);
  expect(after.opens).toBe(1);
  expect(after.text).toBe(before.text);
},30000);
