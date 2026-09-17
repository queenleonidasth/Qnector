import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolated fault-injection smoke: daemon dies mid-command; the same already
// dispatched worker must finish and the replacement daemon imports its result.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(path.join(tmpdir(), 'qnector-durable-recovery-'));
const bundle = process.env.QNECTOR_SMOKE_BUNDLE_DIR ?? path.join(projectRoot, 'packages/execution/job-host/dist');
const executable = process.env.QNECTOR_SMOKE_EXECUTABLE ?? process.execPath;
const host = path.join(bundle, 'qnector-job-host.exe');
if (!existsSync(host)) throw new Error('JOB_HOST_MISSING');
const {daemonRequest} = await import('../apps/daemon/dist/client.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = [];
async function launch() {
  const child = spawn(executable, [path.join(bundle, 'daemon.mjs')], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, ELECTRON_RUN_AS_NODE: '1', QNECTOR_DURABLE_ROOT: root, QNECTOR_JOB_HOST_PATH: host},
  });
  children.push(child);
  let output = '';
  let errors = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {output += chunk;});
  child.stderr.on('data', chunk => {errors += chunk;});
  const deadline = Date.now() + 12000;
  while (!output.includes('QNECTOR_DURABLE_READY')) {
    if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline)
      throw new Error(`DAEMON_BOOT_FAILED ${errors} ${output}`);
    await delay(50);
  }
  return child;
}
async function waitForState(taskId, states, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reply = await daemonRequest(root, {action:'get', taskId});
    if (!reply.ok) throw new Error(`GET_FAILED ${JSON.stringify(reply)}`);
    if (states.includes(reply.data?.state)) return reply.data;
    await delay(75);
  }
  throw new Error(`WAIT_STATE_TIMED_OUT ${taskId} ${states.join(',')}`);
}
try {
  const original = await launch();
  const marker = path.join(root, 'once.txt');
  const input = {action:'submit', workspace:root, idempotencyKey:'same-key-after-daemon-loss',
    timeoutMs:12000, command:{kind:'direct', file:process.execPath, args:['-e',
      "setTimeout(()=>{require('fs').appendFileSync(process.argv[1],'ONCE\\n');console.log('RECOVERED')},2200)",marker]}};
  const first = await daemonRequest(root, input);
  if (!first.ok || !first.data?.taskId) throw new Error(`SUBMIT_FAILED ${JSON.stringify(first)}`);
  const taskId = first.data.taskId;
  await waitForState(taskId, ['running']);
  if (!original.kill()) throw new Error('OLD_DAEMON_KILL_FAILED');
  await new Promise(resolve => original.once('close', resolve));
  await launch();
  const retry = await daemonRequest(root, input);
  if (!retry.ok || retry.data?.taskId !== taskId || retry.data?.reused !== true)
    throw new Error(`DUPLICATE_AFTER_RECONNECT ${JSON.stringify(retry)}`);
  const finished = await waitForState(taskId, ['succeeded','failed','interrupted'], 15000);
  if (finished.state !== 'succeeded') throw new Error(`JOB_NOT_RECOVERED ${JSON.stringify(finished)}`);
  if (readFileSync(marker, 'utf8') !== 'ONCE\n') throw new Error('SIDE_EFFECT_DUPLICATED_OR_LOST');
  const output = await daemonRequest(root, {action:'output', taskId, stream:'stdout'});
  if (!output.ok || output.data?.text !== 'RECOVERED\n' || !output.data?.complete)
    throw new Error(`RECOVERED_OUTPUT_INCOMPLETE ${JSON.stringify(output)}`);
  console.log('DURABLE_PACKAGED_RECOVERY_PASSED');
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once('close', resolve)), delay(5000)]);
    }
  }
  rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 150});
}
