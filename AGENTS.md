# Qnector implementation notes

Read `../devq.md` before changing this repository. The document is the product source of truth.

Use Node.js 22+ and pnpm. Keep the headless MCP runtime usable without Electron. Qnector remains a personal full-access bridge, not a sandbox. Plan Mode, task planning UI, and Plan/Act approval guards are removed. The eight grouped MCP tools remain direct actions with ChatGPT's own permission/confirmation model; Memory v2 and durable tasks provide continuity. The active workspace remains context rather than an access boundary.

After changes, run:

```powershell
npx pnpm@10.15.0 typecheck
npx pnpm@10.15.0 test
```

Do not automate ChatGPT browser sessions or store ChatGPT cookies/tokens.
