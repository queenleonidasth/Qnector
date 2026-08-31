# ChatGPT Plus compatibility record

This file is intentionally a template. Complete it while running Phase 0 against the actual ChatGPT account/workspace.

## Test record

- Date/time (local): `not run`
- ChatGPT UI path/labels: `not run`
- Account/workspace: `personal ChatGPT Plus`
- Model selected: `not run`
- Public MCP URL: `not run`
- Qnector commit/version: `0.1.0`

## Required checks

- [ ] ChatGPT scans the MCP endpoint and lists `ping`, `read_test`, `write_test`.
- [ ] `ping` returns `{ "ok": true, "time": "..." }`.
- [ ] `read_test` reads the test file.
- [ ] `write_test` creates/updates `qnector-write-test.txt` on this computer.

## Result

`write_test` is the Phase 0 exit criterion for the full local ChatGPT Web workflow. If the account permits reads but blocks writes, record the exact UI message here, leave annotations truthful, and continue local Qnector development with the limitation documented.
