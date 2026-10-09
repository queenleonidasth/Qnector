import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityLogger } from "../../core/src/activity-log.js";
import { defaultConfig } from "../../core/src/config.js";
import { QnectorRuntime } from "./server.js";

let runtime: QnectorRuntime | undefined;
let root: string | undefined;
afterEach(async () => {
  await runtime?.stop();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  runtime = undefined;
});

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function rpc(port: number, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch("http://127.0.0.1:" + port + "/mcp", {
    method:"POST",
    headers:{"content-type":"application/json",accept:"application/json,text/event-stream"},
    body:JSON.stringify({jsonrpc:"2.0",id:5,method,params}),
  });
  const body = await response.text();
  const sse = body.split(/\r?\n/).find((line) => line.startsWith("data:"));
  if (!response.ok) throw Error("HTTP " + response.status + " " + body);
  return (sse ? JSON.parse(sse.slice(5).trim()) : JSON.parse(body)) as {
    result?: { structuredContent?: Record<string, unknown>; tools?: Array<Record<string, unknown>>; contents?: Array<Record<string,unknown>>; resources?: Array<Record<string,unknown>> };
  };
}
async function call(port:number, name:string, args:Record<string,unknown>) {
  return (await rpc(port,"tools/call",{name,arguments:args})).result?.structuredContent as
    | {ok:boolean;error?:{code:string};data?:{data?:Record<string,unknown>}}
    | undefined;
}

describe("Plan/Act live MCP integration", () => {
  it("publishes read-only inspection, a task plan controller, separate approval and an inline app resource", async () => {
    root = await mkdtemp(path.join(tmpdir(),"qnector-mcp-mode-"));
    const port = await freePort();
    runtime = new QnectorRuntime({
      config:{...defaultConfig(root),localPort:port},
      configFile:path.join(root,"config.json"),
      logger:new ActivityLogger(path.join(root,"activity.jsonl")),
    });
    await runtime.start({port});
    const tools = (await rpc(port,"tools/list")).result?.tools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["mode","mode_approve","inspect"]));
    expect(tools.find((tool) => tool.name === "inspect")?.annotations)
      .toMatchObject({readOnlyHint:true,destructiveHint:false});
    const resources = (await rpc(port,"resources/list")).result?.resources ?? [];
    expect(resources.map((entry) => entry.uri)).toContain("ui://qnector/plan-act.html");
    const view = (await rpc(port,"resources/read",{uri:"ui://qnector/plan-act.html"})).result?.contents ?? [];
    expect(String(view[0]?.text)).toContain("Qnector");
    expect(String(view[0]?.text)).toContain("mode_approve");

    const task = "task_test_plan_act";
    await writeFile(path.join(root,"existing.txt"),"readable");
    const modeStatus = await call(port,"inspect",{target:"mode",request:{action:"get"},memoryTaskId:task});
    expect(modeStatus?.ok).toBe(true);
    expect(modeStatus?.data?.data?.mode).toBe("act");
    const disallowedDraft = await call(port,"inspect",{target:"mode",request:{action:"begin"},memoryTaskId:task});
    expect(disallowedDraft?.error?.code).toBe("READ_ONLY_TOOL_DENIED");
    const start = await call(port,"mode",{
      action:"begin",memoryTaskId:task,title:"Safe feature",
      summary:"Inspect before edit",steps:["Read old file","Write new file"],
    });
    expect(start?.ok).toBe(true);
    expect(start?.data?.data?.mode).toBe("plan");
    expect(await readFile(path.join(root,"existing.txt"),"utf8")).toBe("readable");

    const inspectRead = await call(port,"inspect",{
      target:"files",request:{action:"read",path:"existing.txt"},memoryTaskId:task,
    });
    expect(inspectRead?.ok).toBe(true);
    const inspectMutation = await call(port,"inspect",{
      target:"files",request:{action:"write",path:"forbidden.txt",content:"bad"},memoryTaskId:task,
    });
    expect(inspectMutation?.error?.code).toBe("READ_ONLY_TOOL_DENIED");

    const denied = await call(port,"files",{
      action:"write",path:"blocked.txt",content:"bad",memoryTaskId:task,
    });
    expect(denied?.error?.code).toBe("PLAN_MODE_READ_ONLY");
    await expect(readFile(path.join(root,"blocked.txt"),"utf8")).rejects.toThrow();

    const wrongRevision = await call(port,"mode_approve",{expectedRevision:9,memoryTaskId:task});
    expect(wrongRevision?.error?.code).toBe("PLAN_REVISION_MISMATCH");
    const accepted = await call(port,"mode_approve",{expectedRevision:1,memoryTaskId:task});
    expect(accepted?.ok).toBe(true);
    expect(accepted?.data?.data?.mode).toBe("act");

    const written = await call(port,"files",{
      action:"write",path:"approved.txt",content:"allowed",memoryTaskId:task,
    });
    expect(written?.ok).toBe(true);
    expect(await readFile(path.join(root,"approved.txt"),"utf8")).toBe("allowed");
    const back = await call(port,"mode",{action:"back_to_plan",memoryTaskId:task});
    expect(back?.data?.data?.mode).toBe("plan");
    const deniedAgain = await call(port,"files",{
      action:"delete",path:"approved.txt",memoryTaskId:task,
    });
    expect(deniedAgain?.error?.code).toBe("PLAN_MODE_READ_ONLY");
    expect(await readFile(path.join(root,"approved.txt"),"utf8")).toBe("allowed");
  });
});
