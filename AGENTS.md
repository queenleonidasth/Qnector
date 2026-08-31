# Qnector implementation notes

Read `../devq.md` before changing this repository. The document is the product source of truth.

Use Node.js 22+ and pnpm. Keep the headless MCP runtime usable without Electron. Do not add an internal permissions or approval layer: Qnector is intentionally a personal full-access bridge, and the active workspace is context rather than an access boundary.

After changes, run:

```powershell
npx pnpm@10.15.0 typecheck
npx pnpm@10.15.0 test
```

Do not automate ChatGPT browser sessions or store ChatGPT cookies/tokens.
