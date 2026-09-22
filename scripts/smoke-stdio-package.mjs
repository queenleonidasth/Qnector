import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Release gate: actual packed Qnector.exe as Node runtime runs both the
// independent daemon and the stdio entry inside app.asar. Stdio dies mid-job;
// the original IPC task must still complete with exactly one side effect.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(path.join(tmpdir(), 'qnector-packaged-stdio-'));
const daemonRoot = path.join(root, 'durable');
const bundle = process.env.QNECTOR_SMOKE_BUNDLE_DIR ?? path.join(repo, 'packages/execution/job-host/dist');
const executable = process.env.QNECTOR_SMOKE_EXECUTABLE ?? process.execPath;
const cli = process.env.QNECTOR_SMOKE_STDIO_CLI ?? path.join(repo, 'packages/mcp-server/dist/stdio-cli.js');
const host = path.join(bundle, 'qnector-job-host.exe');
if (!existsSync(host)) throw new Error('STDIO_SMOKE_JOB_HOST_MISSING');
const {daemonRequest} = await import('../apps/daemon/dist/client.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const processes = [];
async function closeOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([new Promise(resolve => child.once('close', resolve)), delay(5000)]);
}
let frontend;
try {
  const daemon = spawn(executable, [path.join(bundle, 'daemon.mjs')], {
    windowsHide:true, stdio:['ignore','pipe','pipe'],
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',QNECTOR_DURABLE_ROOT:daemonRoot,QNECTOR_JOB_HOST_PATH:host},
  });
  processes.push(daemon);
  let daemonOut = '', daemonError = '';
  daemon.stdout.setEncoding('utf8'); daemon.stderr.setEncoding('utf8');
  daemon.stdout.on('data',chunk => {daemonOut += chunk;});
  daemon.stderr.on('data',chunk => {daemonError += chunk;});
  const readyDeadline = Date.now()+12000;
  while (!daemonOut.includes('QNECTOR_DURABLE_READY')) {
    if (daemon.exitCode !== null || daemon.signalCode !== null || Date.now()>readyDeadline)
      throw new Error(`STDIO_DAEMON_BOOT_FAILED ${daemonOut} ${daemonError}`);
    await delay(50);
  }
  frontend = spawn(executable,[cli], {cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe'],
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',QNECTOR_DURABLE_PREVIEW:'1',QNECTOR_DURABLE_ROOT:daemonRoot,
      QNECTOR_WORKSPACE:root,QNECTOR_CONFIG_FILE:path.join(root,'stdio-config.json')},
  });
  processes.push(frontend);
  let stdioError='', buffer='', unexpectedStdout='';
  const pending=new Map();
  frontend.stderr.setEncoding('utf8'); frontend.stdout.setEncoding('utf8');
  frontend.stderr.on('data',chunk=>{stdioError+=chunk;});
  frontend.stdout.on('data',chunk=>{
    buffer+=chunk;
    let end;
    while ((end=buffer.indexOf('\n'))>=0) {
      const line=buffer.slice(0,end); buffer=buffer.slice(end+1);
      try {
        const value=JSON.parse(line);
        if (value.jsonrpc !== '2.0') { unexpectedStdout+=line; continue; }
        if (typeof value.id==='number') {pending.get(value.id)?.(value); pending.delete(value.id);}
      } catch {unexpectedStdout+=line;}
    }
  });
  async function rpc(id,method,params={}) {
    const response=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`STDIO_RPC_TIMED_OUT ${method} ${stdioError} ${unexpectedStdout}`));},12000);
      pending.set(id,value=>{clearTimeout(timeout);resolve(value);});
    });
    frontend.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    return response;
  }
  const initialized=await rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'packaged-smoke',version:'1'}});
  if (!initialized.result || initialized.error) throw new Error(`STDIO_INIT_FAILED ${JSON.stringify(initialized)} ${stdioError}`);
  frontend.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listed=await rpc(2,'tools/list');
  if (!listed.result?.tools?.some(tool=>tool.name==='tasks'))
    throw new Error(`STDIO_TASKS_NOT_ADVERTISED ${JSON.stringify(listed)}`);
  if (listed.result?.tools?.some(tool=>tool.name==='social'))
    throw new Error('PACKAGED_REMOVED_SOCIAL_TOOL_ADVERTISED');
  const marker=path.join(root,'once.txt');
  const start=await rpc(3,'tools/call',{name:'tasks',arguments:{action:'start',idempotencyKey:'packaged-stdio-once',waitTimeoutMs:0,
    command:{kind:'direct',file:process.execPath,args:['-e',
      "setTimeout(()=>{require('fs').appendFileSync(process.argv[1],'ONCE\\n');console.log('PACKAGED_STDIO_OK')},1700)",marker]}}});
  const taskId=start.result?.structuredContent?.data?.taskId;
  if (!start.result?.structuredContent?.ok || !/^task_/.test(taskId??''))
    throw new Error(`STDIO_SUBMIT_FAILED ${JSON.stringify(start)}`);
  if (unexpectedStdout) throw new Error(`STDIO_STDOUT_CONTAMINATED ${unexpectedStdout}`);
  await closeOwned(frontend);
  const waited=await daemonRequest(daemonRoot,{action:'wait',taskId,waitTimeoutMs:9000},10500);
  if (!waited.ok || waited.data?.state!=='succeeded')
    throw new Error(`STDIO_FRONTEND_LOSS_FAILED ${JSON.stringify(waited)}`);
  if (readFileSync(marker,'utf8')!=='ONCE\n') throw new Error('STDIO_SIDE_EFFECT_DUPLICATE_OR_MISSING');
  const output=await daemonRequest(daemonRoot,{action:'output',taskId,stream:'stdout'});
  if (!output.ok || output.data?.text!=='PACKAGED_STDIO_OK\n' || !output.data?.complete)
    throw new Error(`STDIO_OUTPUT_INCOMPLETE ${JSON.stringify(output)}`);
  console.log('PACKAGED_STDIO_PARITY_PASSED');
} finally {
  for (const child of processes.reverse()) await closeOwned(child);
  rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
