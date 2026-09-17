import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DurableDaemon } from "../../../apps/daemon/src/server.js";
import { ActivityLogger } from "../../core/src/activity-log.js";
import { defaultConfig } from "../../core/src/config.js";
import { QnectorRuntime } from "./server.js";

let root: string | undefined;
let daemon: DurableDaemon | undefined;
let runtime: QnectorRuntime | undefined;
let child: ChildProcess | undefined;
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function http(port: number, action: string, args: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {method: "POST",
    headers: {"content-type":"application/json", accept:"application/json, text/event-stream"},
    body: JSON.stringify({jsonrpc:"2.0", id: 44, method:"tools/call", params:{name:"tasks", arguments:{action,...args}}})});
  const raw = await response.text();
  const data = raw.split(/\r?\n/).find(line => line.startsWith("data:"));
  return (JSON.parse(data ? data.slice(5).trim() : raw) as {result?: {structuredContent?: {ok: boolean; data?: Record<string, unknown>}}})
    .result?.structuredContent;
}
afterEach(async () => {
  if (child?.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([new Promise(resolve => child?.once("close", resolve)), new Promise(resolve => setTimeout(resolve, 1000))]);
  }
  await runtime?.stop();
  await daemon?.close();
  if (root) rmSync(root, {recursive:true, force:true});
  root = undefined; daemon = undefined; runtime = undefined; child = undefined;
});

describe("stdio CLI process and daemon ownership", () => {
  it("keeps stdout JSON-RPC only and survives termination of its own frontend", async () => {
    root = mkdtempSync(path.join(tmpdir(), "qnector-stdio-cli-"));
    const daemonRoot = path.join(root, "durable");
    const host = path.resolve(process.cwd(), "packages/execution/job-host/dist/qnector-job-host.exe");
    if (process.platform === "win32") expect(existsSync(host)).toBe(true);
    daemon = new DurableDaemon(daemonRoot, process.platform === "win32" ? {jobHostPath: host} : {});
    await daemon.start();
    const port = await freePort();
    runtime = new QnectorRuntime({config:{...defaultConfig(root), localPort:port},
      configFile:path.join(root,"http-config.json"),
      logger:new ActivityLogger(path.join(root,"http-activity.jsonl")), durableDaemonRoot:daemonRoot});
    await runtime.start({port});
    const cli = path.resolve(import.meta.dirname, "../dist/stdio-cli.js");
    expect(existsSync(cli)).toBe(true);
    child = spawn(process.execPath, [cli], {cwd:process.cwd(), windowsHide:true,
      stdio:["pipe","pipe","pipe"], env:{...process.env, QNECTOR_DURABLE_PREVIEW:"1", QNECTOR_DURABLE_ROOT:daemonRoot,
        QNECTOR_WORKSPACE:root, QNECTOR_CONFIG_FILE:path.join(root,"stdio-config.json")}});
    let buffer = "";
    let stderr = "";
    const pending = new Map<number,(message: Record<string, unknown>)=>void>();
    const responses: Array<Record<string, unknown>> = [];
    child.stderr?.on("data", chunk => {stderr += String(chunk);});
    child.stdout?.on("data", chunk => {
      buffer += String(chunk);
      let pos: number;
      while ((pos = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0,pos); buffer = buffer.slice(pos+1);
        try {
          const value = JSON.parse(line) as Record<string, unknown>;
          responses.push(value);
          const id = value.id;
          if (typeof id === "number") {pending.get(id)?.(value); pending.delete(id);}
        } catch { stderr += `NON_JSON_STDOUT:${line}`; }
      }
    });
    const rpc = async (id:number, method:string, params:Record<string,unknown> = {}) => {
      const response = new Promise<Record<string,unknown>>((resolve,reject)=>{
        const timeout = setTimeout(()=>{pending.delete(id);reject(new Error(`CLI_RPC_TIMEOUT_${method}:${stderr}`));},10_000);
        pending.set(id,value=>{clearTimeout(timeout);resolve(value);});
      });
      child?.stdin?.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
      return response;
    };
    expect((await rpc(1,"initialize",{protocolVersion:"2025-06-18", capabilities:{},clientInfo:{name:"stdio-cli-test",version:"1"}})).result).toBeTruthy();
    child.stdin?.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");
    const tools = (await rpc(2,"tools/list")).result as {tools:Array<{name:string}>};
    expect(tools.tools.some(tool=>tool.name==="tasks")).toBe(true);
    const marker = path.join(root,"exactly-once.txt");
    const start = (await rpc(3,"tools/call",{name:"tasks",arguments:{action:"start",idempotencyKey:"stdio-frontend-crash", waitTimeoutMs:0,
      command:{kind:"direct",file:process.execPath,args:["-e",
        "setTimeout(()=>{require('fs').appendFileSync(process.argv[1],'ONE\\n');console.log('FRONTEND_GONE')},1500)",marker]}}}));
    const taskId = String(((start.result as {structuredContent?:{data?:{taskId?:string}}})?.structuredContent?.data?.taskId));
    expect(taskId).toMatch(/^task_/);
    expect(responses.every(value=>value.jsonrpc==="2.0")).toBe(true);
    expect(stderr).not.toContain("NON_JSON_STDOUT");
    child.kill();
    await new Promise(resolve => child?.once("close",resolve));
    const waited = await http(port,"wait",{taskId,waitTimeoutMs:7_000});
    expect(waited?.data).toMatchObject({taskId,state:"succeeded"});
    expect((await http(port,"output",{taskId,stream:"stdout"}))?.data)
      .toMatchObject({text:"FRONTEND_GONE\n",complete:true});
    expect(readFileSync(marker,"utf8")).toBe("ONE\n");
  }, 25_000);
});
