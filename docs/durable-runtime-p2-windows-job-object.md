# Durable Runtime P2 — Windows Job Object hardening (opt-in development preview)

Date: 2026-09-17. Feature branch: `feat/durable-runtime-foundation`.

## Changes

- Windows Job Host source: `packages/execution/job-host/Program.cs`, .NET 8 single-file self-contained Windows x64 build, created by `scripts/build-job-host.ps1`. The 64+ MiB generated executable is ignored in Git; it must be built from source before integration tests and Windows packaging.
- The Job Host creates a Windows `KILL_ON_JOB_CLOSE` Job Object, spawns the command with `CreateProcessW(CREATE_SUSPENDED | CREATE_NO_WINDOW)`, assigns its process to the Job, and only then resumes the primary thread. If assignment fails, the process remains suspended and is terminated. The original kernel process handle is retained for exit-code collection, including fast-exiting children.
- The coordinator now creates attempt directories before launching workers, and supports a pre-GO `CANCEL` handshake. A cancel request immediately after accepting/claiming the task cannot fail with ENOENT or accidentally launch a command; the worker writes its no-execution cancellation manifest without spawning a process.
- The Host monitors worker PID and OS creation time, explicit cancel file, and execution timeout. It terminates the owned Job on worker loss/cancel/timeout, closes the Job before publishing atomic `job-host-status.json`, and never claims cancellation if the Job termination syscall fails. Stdout/stderr flow directly through the inherited worker pipes. The worker still owns the output spool and completion manifest; cancellation is only confirmed after host closure and manifest import.
- Opt-in wiring: `DurableRunner({jobHostPath})` and `DurableDaemon(root, {jobHostPath})`. Standalone daemon CLI accepts `QNECTOR_JOB_HOST_PATH`; with no flag/path it preserves the existing legacy detached-worker implementation. Installed QNECTOR is not reconfigured.
- `apps/desktop/electron-builder.yml` lists the built executable as `resources/durable-runtime/qnector-job-host.exe`; `scripts/package-windows.ps1` builds it, includes its crash/cancel integration test in the release gate and verifies the packaged file. Generated .NET bin/obj/dist directories are ignored.

## Verification and limitations

Run `powershell -ExecutionPolicy Bypass -File scripts/build-job-host.ps1`, then `npx.cmd pnpm@10.15.0 typecheck`, `npx.cmd pnpm@10.15.0 test`, `npx.cmd pnpm@10.15.0 lint`. Windows tests cover killed worker + grandchild, explicit cancel + grandchild, and short-lived exit 0/7 with stdout/stderr and valid manifests. Missing Windows Host must fail tests rather than skip.

This commit is **not a release gate completion**: packaged installation/runtime boot has not been exercised end-to-end, nor have the Windows ACL/audit, reboot, overnight soak, lease recovery, resource budgets, and MCP migration gates. The Host currently uses inheritable standard handles without an explicit restricted handle-list attribute; review other inherited handles and sandbox implications before enabling on untrusted inputs. Do not infer that ChatGPT can autonomously keep thinking after a web disconnect: the independent worker can preserve only work that has already been durably dispatched. No default daemon was started or existing QNECTOR instance restarted.
