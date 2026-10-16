import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {it,expect,vi} from "vitest";
import {defaultConfig} from "../../core/src/config.js";
import type {GenericLspService} from "../../core/src/generic-lsp.js";
import {QnectorRuntime} from "./server.js";

it("closes on-demand generic LSP sessions when the Qnector runtime stops", async () => {
  const root=await mkdtemp(path.join(tmpdir(),"qnector-lsp-lifecycle-"));
  const close=vi.fn(async()=>undefined);
  const genericLsp={close,status:()=>[],request:async()=>{throw new Error("unused")}} as unknown as GenericLspService;
  const runtime=new QnectorRuntime({
    config:defaultConfig(root),configFile:path.join(root,"config.json"),genericLsp,
  });
  try {
    await runtime.stop();
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
},20000);
