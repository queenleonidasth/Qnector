import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(path.join(tmpdir(), 'qnector-packaged-durable-smoke-'));
const bundleRoot = process.env.QNECTOR_SMOKE_BUNDLE_DIR ?? path.join(projectRoot, 'packages/execution/job-host/dist');
const host = path.join(bundleRoot, 'qnector-job-host.exe');
if (!existsSync(host)) throw new Error('JOB_HOST_MISSING');
const { daemonRequest } = await import('../apps/daemon/dist/client.js');
const executable = process.env.QNECTOR_SMOKE_EXECUTABLE ?? process.execPath;
const child = spawn(executable, [path.join(bundleRoot, 'daemon.mjs')], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, ELECTRON_RUN_AS_NODE: '1', QNECTOR_DURABLE_ROOT: root, QNECTOR_JOB_HOST_PATH: host},
});
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => { stderr += chunk; });
let stdout = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => { stdout += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const deadline = Date.now() + 10000;
  while (!stdout.includes('QNECTOR_DURABLE_READY')) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`DAEMON_BOOT_FAILED ${stderr} ${stdout}`);
    await delay(60);
  }
  const ping = await daemonRequest(root, {action:'ping'});
  if (!ping.ok || ping.data.state !== 'ready') throw new Error(`PING_FAILED ${JSON.stringify(ping)}`);
  const doctor = await daemonRequest(root, {action:'doctor'});
  if (!doctor.ok || doctor.data?.state !== 'ready' || doctor.data?.storage?.integrity !== 'ok' ||
      doctor.data?.storage?.journalMode !== 'wal' || doctor.data?.storage?.synchronous !== 2)
    throw new Error(`DURABLE_STORAGE_DOCTOR_FAILED ${JSON.stringify(doctor)}`);
  const marker = path.join(root, 'completed.txt');
  const command = {kind:'direct', file:process.execPath, args:['-e',
    "require('fs').writeFileSync(process.argv[1],'PACKAGED_OK');process.stdout.write('OK');", marker]};
  const accepted = await daemonRequest(root, {action:'submit', workspace:root, idempotencyKey:'smoke-bundle-once', command, timeoutMs:10000});
  if (!accepted.ok) throw new Error(`SUBMIT_FAILED ${JSON.stringify(accepted)}`);
  const taskId = accepted.data.taskId;
  const result = await daemonRequest(root, {action:'wait', taskId, waitTimeoutMs:15000},17000);
  if (!result.ok || result.data.state !== 'succeeded') throw new Error(`WAIT_FAILED ${JSON.stringify(result)}`);
  if (readFileSync(marker,'utf8') !== 'PACKAGED_OK') throw new Error('MARKER_INCORRECT');
  const output = await daemonRequest(root, {action:'output', taskId, stream:'stdout'});
  if (!output.ok || output.data.text !== 'OK') throw new Error(`OUTPUT_FAILED ${JSON.stringify(output)}`);
  console.log('DURABLE_BUNDLE_SMOKE_PASSED');
} finally {
  child.kill();
  await Promise.race([new Promise(resolve => child.once('close', resolve)), delay(5000)]);
  rmSync(root, {recursive:true, force:true, maxRetries:5, retryDelay:100});
}
