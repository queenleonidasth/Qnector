import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

// Explicit manual acceptance only: uses the owner's pre-authenticated browser,
// creates isolated QNECTOR config, never stores cookies or modifies production.
if (process.env.QNECTOR_SOCIAL_LIVE_ACCEPT !== '1') throw Error('EXPLICIT_LIVE_SOCIAL_ACCEPT_REQUIRED');
if (process.platform !== 'win32') throw Error('WINDOWS_PACKAGED_TEST_ONLY');
const repo = path.resolve(import.meta.dirname, '..');
const candidate = process.env.QNECTOR_SOCIAL_CANDIDATE ?? path.join(repo, 'apps/desktop/release/durable-candidate-20260920-004231');
const exe = path.join(candidate, 'win-unpacked', 'Qnector.exe');
const cli = path.join(candidate, 'win-unpacked', 'resources', 'app.asar', 'node_modules', '@qnector', 'mcp-server', 'dist', 'stdio-cli.js');
const integration = path.join(process.env.LOCALAPPDATA ?? '', 'Qnector', 'integrations', 'agent-reach');
const doctor = path.join(integration, 'venv', 'Scripts', 'agent-reach.exe');
const opencli = path.join(integration, 'opencli', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
const node = process.env.QNECTOR_SOCIAL_NODE;
if (![exe, doctor, opencli, node].every(x => x && existsSync(x))) throw Error('PACKAGED_OR_PINNED_DEPENDENCY_MISSING');
const root = mkdtempSync(path.join(tmpdir(), 'qnector-fb-packaged-live-'));
const cfg = path.join(root, 'config.json');
writeFileSync(cfg, JSON.stringify({ social: { enabled: true, platforms: ['facebook'], agentReachPath: doctor, opencliPath: opencli, nodePath: node, authMode: 'existing-chrome-session', timeoutMs: 30000 } }));
let child;
const pending = new Map();
let buffer = '', stderr = '', stdoutNoise = '';
const close = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  child.kill();
  await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
};
try {
  child = spawn(exe, [cli], { cwd: repo, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', QNECTOR_CONFIG_FILE: cfg, QNECTOR_WORKSPACE: root } });
  child.stderr.setEncoding('utf8'); child.stdout.setEncoding('utf8');
  child.stderr.on('data', c => { stderr = (stderr + c).slice(-2000); });
  child.stdout.on('data', c => {
    buffer += c;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      try { const message = JSON.parse(line); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); callback(message); } else if (message.jsonrpc !== '2.0') stdoutNoise += line; }
      catch { stdoutNoise += line; }
    }
  });
  const rpc = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('MCP_TIMEOUT_' + method + ':' + stderr)); }, 45000);
    pending.set(id, m => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'social-live-acceptance', version: '1' } });
  if (!init.result || init.error) throw Error('MCP_INITIALIZATION_FAILED');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await rpc(2, 'tools/list');
  if (!tools.result?.tools?.some(t => t.name === 'social')) throw Error('PACKAGED_SOCIAL_TOOL_MISSING');
  const health = (await rpc(3, 'tools/call', { name: 'social', arguments: { action: 'health' } })).result?.structuredContent;
  console.log('PACKAGED_SOCIAL_HEALTH', JSON.stringify({ ok: health?.ok, facebook: health?.data?.capabilities?.facebookSearch, error: health?.error?.code }));
  if (!health?.ok || !health.data?.capabilities?.facebookSearch) throw Error('PACKAGED_FACEBOOK_HEALTH_FAILED');
  const search = (await rpc(4, 'tools/call', { name: 'social', arguments: { action: 'search', platform: 'facebook', query: 'OpenAI', limit: 2 } })).result?.structuredContent;
  const urls = search?.data?.items?.map(item => item.url) ?? [];
  console.log('PACKAGED_SOCIAL_SEARCH', JSON.stringify({ ok: search?.ok, status: search?.data?.status, count: urls.length, urls, error: search?.error?.code }));
  if (!search?.ok || search.data?.status !== 'ready' || !urls.length || urls.some(url => !/^https:\/\/(www\.)?facebook\.com\//.test(url))) throw Error('PACKAGED_FACEBOOK_SEARCH_FAILED');
  if (stdoutNoise) throw Error('PACKAGED_STDOUT_CONTAMINATED');
  console.log('PACKAGED_SOCIAL_FACEBOOK_PASSED');
} finally {
  await close();
  try { rmSync(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 }); }
  catch (error) { console.error('TEMP_CLEANUP_DEFERRED', error.code ?? String(error)); }
}
