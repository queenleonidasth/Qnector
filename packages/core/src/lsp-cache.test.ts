import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TypeScriptCodeIntelligence } from "./code-intelligence.js";

let root: string|undefined;
afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});root=undefined;});

describe("TypeScript language cache capacity and version invalidation",()=>{
  it("keeps only six most recent read-only project services and reindexes evicted entries",async()=>{
    root=await mkdtemp(path.join(os.tmpdir(),"qnector-lsp-lru-"));
    const service=new TypeScriptCodeIntelligence();
    const projects=[] as string[];
    for(let i=0;i<7;i++){
      const directory=path.join(root,String(i));
      projects.push(directory);
      await mkdir(directory,{recursive:true});
      await writeFile(path.join(directory,"tsconfig.json"),JSON.stringify({
        compilerOptions:{strict:true,noEmit:true,target:"ES2022"},include:["entry.ts"],
      }));
      await writeFile(path.join(directory,"entry.ts"),"export const qnector_symbol_"+i+" = "+i+";\n");
      const result=await service.documentSymbols({workspaceRoot:directory,path:"entry.ts"});
      expect(result.symbols.some(x=>x.name==="qnector_symbol_"+i)).toBe(true);
    }
    const cache=(service as unknown as {languageServiceCache:Map<string,unknown>}).languageServiceCache;
    expect(cache.size).toBe(6);
    expect(cache.has(path.join(projects[0]!,"tsconfig.json"))).toBe(false);
    expect(cache.has(path.join(projects[6]!,"tsconfig.json"))).toBe(true);
    const recovered=await service.documentSymbols({workspaceRoot:projects[0]!,path:"entry.ts"});
    expect(recovered.symbols.some(x=>x.name==="qnector_symbol_0")).toBe(true);
    expect(cache.size).toBe(6);
    expect(cache.has(path.join(projects[0]!,"tsconfig.json"))).toBe(true);
    expect(cache.has(path.join(projects[1]!,"tsconfig.json"))).toBe(false);
    await writeFile(path.join(projects[0]!,"entry.ts"),"export const qnector_changed_symbol = 100;\n");
    const changed=await service.documentSymbols({workspaceRoot:projects[0]!,path:"entry.ts"});
    expect(changed.symbols.some(x=>x.name==="qnector_changed_symbol")).toBe(true);
    expect(changed.symbols.some(x=>x.name==="qnector_symbol_0")).toBe(false);
    expect(cache.size).toBe(6);
  });
});
