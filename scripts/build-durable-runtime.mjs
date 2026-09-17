import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'packages', 'execution', 'job-host', 'dist');
mkdirSync(outdir, { recursive: true });
// Keep the entrypoints adjacent: DurableRunner locates ./worker-main.js relative
// to its own ESM bundle, independently of the Electron app.asar filesystem.
for (const [entry, outfile] of [
  ['apps/daemon/src/cli.ts', 'daemon.mjs'],
  ['packages/execution/src/worker-main.ts', 'worker-main.js'],
]) {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(outdir, outfile),
    platform: 'node',
    target: 'node22',
    format: 'esm',
    bundle: true,
    packages: 'bundle',
    sourcemap: false,
    minify: false,
    logLevel: 'warning',
    external: ['node:*'],
  });
}
console.log(`DURABLE_RUNTIME_BUNDLE_READY ${outdir}`);
