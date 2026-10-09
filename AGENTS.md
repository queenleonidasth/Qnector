# Qnector implementation notes

Read `../devq.md` before changing this repository. The document is the product source of truth.

Use Node.js 22+ and pnpm. Keep the headless MCP runtime usable without Electron. Qnector remains a personal full-access bridge, not a sandbox. Plan/Act uses a task-scoped, behavioral MCP dispatch guard: Plan Mode denies mutation/tool execution and Act Mode preserves the normal permissions of the Windows account. Plan approval is a task workflow action, not OS-level access control or a bypass of ChatGPT's confirmations. The active workspace remains context rather than an access boundary.

After changes, run:

```powershell
npx pnpm@10.15.0 typecheck
npx pnpm@10.15.0 test
```

Do not automate ChatGPT browser sessions or store ChatGPT cookies/tokens.
