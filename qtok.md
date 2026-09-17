# QNECTOR Durable Runtime — Handoff / Implementation Status (`qtok`)

วันที่: 2026-09-17 (Asia/Bangkok)  |  สถานะล่าสุด 22:50: **กลับมาพัฒนาตามคำสั่งผู้ใช้; ได้ Windows build candidate ผ่าน smoke/recovery แต่ยังไม่ผ่านทุก gate และยังไม่ Release**

> บันทึกส่วนเดิมด้านล่างเป็น snapshot ตอนหยุดครั้งก่อน อ่านความคืบหน้าใหม่และข้อจำกัดที่หัวข้อ `อัปเดตหลังกลับมาพัฒนา` ท้ายไฟล์เป็นหลัก; อย่าตีความข้อความเก่าว่ายังเป็นสถานะล่าสุด

## Git / ขอบเขต
- Repository: `C:\Users\QUEEN\Projects\qnector`; branch `feat/durable-runtime-foundation`.
- HEAD ที่ยืนยันล่าสุด: `fe1c7be feat(durable): contain Windows job trees and harden pre-dispatch cancellation`.
- Commit ก่อนหน้า: `feade3f` (durable store/spool), `81244a5` (daemon/worker/IPC), `865e95f` (cancellation), `e6bcccf` (signed OS worker identity), `fe1c7be` (Windows Job Host + pre-GO cancel).
- **ยังไม่ commit การแก้ไขหลัง `fe1c7be`; ไม่ได้ push, tag, publish release, install, หรือ restart QNECTOR ที่กำลังใช้อยู่**.
- งาน MCP/ไฟล์เดิมเป็นงานจากอีกกระบวนการ ต้องตรวจ diff และประสานก่อน stage/commit; ห้าม `git add .`, reset หรือ clean ทั้ง repository.

## สิ่งที่ implement และยืนยันแล้ว
1. P1/P2: SQLite execution journal + idempotency, bounded disk stdout/stderr spool, completion manifests, detached workers, standalone daemon IPC, recovery without blind replay, explicit cancellation, OS worker identity (PID + process creation time + signed attempt identity).
2. Windows Job Object Host (`packages/execution/job-host/Program.cs`): process spawned suspended, assign Job before resume, `KILL_ON_JOB_CLOSE`, owner-loss/cancel/timeout containment; original kernel process handle used for fast-exit exit codes. Opt-in via `QNECTOR_JOB_HOST_PATH`/constructor option only.
3. Pre-GO cancellation race fixed: attempt directory prepared before spawn, handshake accepts `CANCEL`; no command execution when canceled before dispatch.
4. MCP `tasks` facade exists **in unstaged work from another process** (`packages/mcp-server/src/durable-task-tool.ts`, `durable-task-mcp.test.ts`, related MCP/daemon package changes). Tests cover default eight tools, opt-in start/idempotency/wait/result/output/cancel. It is currently opt-in via `durableDaemonRoot`, NOT automatically enabled on live installed QNECTOR.
5. Latest full repository validation for current shared working tree before latest desktop packaging edits: `typecheck` PASS, Vitest **275/275 across 54 files PASS**, ESLint PASS (`CURRENT_SHARED_TREE_VALIDATION_PASSED`). Prior `git diff --check` also passed at commit `fe1c7be` stage. **These results do NOT validate the latest desktop wiring edits.**
6. Added `scripts/build-durable-runtime.mjs` (UNCOMMITTED) and generated native/runtime artifacts under `packages/execution/job-host/dist/`: `daemon.mjs` (45,278 B), `worker-main.js` (16,585 B), `qnector-job-host.exe` (67,499,090 B). `scripts/smoke-durable-bundle.mjs` standalone live bundle → IPC → worker → output test passed: `DURABLE_BUNDLE_SMOKE_PASSED`.

## Work in progress right before stop (NOT validated / NOT committed)
- Added `daemon.mjs` and `worker-main.js` to `apps/desktop/electron-builder.yml` extraResources and `scripts/package-windows.ps1` build/resource checks.
- Added Desktop helper `apps/desktop/src/main/durable-daemon.ts`, plus changes to `apps/desktop/package.json`, `apps/desktop/tsconfig.json` and imports in `apps/desktop/src/main/main.ts`.
- **Desktop lifecycle wiring not finished**: last inspection of `initializeRuntime()` still constructs `new Runtime({config, configFile, platform, nonBlockingActivityWrites})` without `durableDaemonRoot`; must invoke helper safely, pass opt-in root, verify daemon readiness, handle existing daemon vs child ownership, preserve jobs on UI exit, and ensure no focus stealing. Do not assume helper is live merely because file exists.
- `package.json` now includes `esbuild: 0.28.2` added by concurrent process; initial `pnpm install --frozen-lockfile` failed due to out-of-date lockfile. `pnpm install --no-frozen-lockfile` subsequently completed and bundle built; inspect latest `pnpm-lock.yaml` diff for unintended formatting churn before commit.
- Current existing `apps/desktop/release/win-unpacked` artifact was built earlier, and was verified to **lack** `resources/durable-runtime/qnector-job-host.exe` and Daemon. No new packaged artifact verification or installed-app end-to-end smoke has passed.
- Missing critical release gates: final package-windows build incl two installers, unpacked asset inspection, installed/portable executable test of durable tasks (start/reconnect/finish/cancel), desktop lifecycle fallback and headless persistence, Windows pipe/token ACL/security review, leak/soak/reboot tests, workflow/transport parity & migration/rollback. These remain open in original `Documents/QNECTOR-Durable-Runtime-Implementation-Plan-2026-09-17.md` P0–P8.
- **Scope caveat:** durable dispatch protects jobs already accepted by local daemon; it does NOT autonomously continue ChatGPT's reasoning after web transport disconnect, nor guarantee fixing platform-side `Connection interrupted` / `Message delivery timed out`.

## Exact working-tree status at stop
```
 M apps/daemon/package.json
 M apps/daemon/src/client.ts
 M apps/desktop/electron-builder.yml
 M apps/desktop/package.json
 M apps/desktop/src/main/main.ts
 M apps/desktop/tsconfig.json
 M package.json
 M packages/mcp-server/package.json
 M packages/mcp-server/src/server.ts
 M packages/mcp-server/src/session-bootstrap.test.ts
 M packages/mcp-server/src/session-bootstrap.ts
 M packages/mcp-server/tsconfig.json
 M packages/tools/src/process-tool.ts
 M pnpm-lock.yaml
 M scripts/package-windows.ps1
?? apps/desktop/src/main/durable-daemon.ts
?? packages/mcp-server/src/durable-task-mcp.test.ts
?? packages/mcp-server/src/durable-task-tool.ts
?? scripts/build-durable-runtime.mjs
?? scripts/smoke-durable-bundle.mjs
```
This file `qtok.md` itself is newly created, untracked, and should also appear in subsequent `git status`.

## Recommended resumption sequence
1. Recheck `git status` and diffs; avoid trampling concurrent MCP/session-bootstrap/process-tool work. Inspect helper `durable-daemon.ts` and bundle generation/packaging scripts.
2. Finish Desktop explicit opt-in lifecycle and no-focus spawn; verify helper and owner/disconnect behavior in tests. Ensure packaged daemon uses actual executable, correct worker path, SQLite support, and host path. Add reliable tests for missing daemon/no config and startup failure.
3. Run `node scripts/build-durable-runtime.mjs`, `node scripts/smoke-durable-bundle.mjs`, then typecheck, full tests, lint, diff check. Validate package on isolated location without restarting installed production app.
4. Run package script and inspect actual unpacked assets, provenance and install/portable end-to-end. Resolve security/soak/upgrade gates and document limitations. Commit only reviewed paths; release/version/tag/publish only after all required gates pass. Otherwise report precise blocker and DO NOT publish a misleading release.

**User instruction at stop:** "หยุดการทำแล้วเขียน md ไฟล์ชื่อ qtok ว่าตอนนี้ implement ถึงไหนแล้ว". Do not continue implementation, release, background work, restart or shutdown unless user explicitly requests again.

## อัปเดตหลังกลับมาพัฒนา — 17 กันยายน 2026 เวลา ~22:50 น.

### สิ่งที่ลงมือทำและผ่านจริง
- ทบทวน working tree และ source; รักษาการแก้เดิมใน `session-bootstrap.ts`, `session-bootstrap.test.ts`, `process-tool.ts` และ MCP `tasks` ที่อีกกระบวนการทำค้างไว้ ไม่ reset/clean/stage รวม.
- Desktop `initializeRuntime()` มี opt-in `QNECTOR_DURABLE_PREVIEW=1` เรียก `ensurePreviewDaemon` และส่ง `durableDaemonRoot` ให้ MCP; default ยัง legacy. ปรับ helper ให้ตรวจ protocol v1 และ `jobHostEnabled`, จัดการ asynchronous spawn error, reuse daemon ที่รันอยู่, ไม่ปิด daemon ที่ไม่ได้สร้างและไม่แย่ง focus.
- Daemon ปฏิเสธ startup หากกำหนด Job Host แต่ binary ไม่มี/OS ไม่รองรับ; `ping` แสดง `jobHostEnabled` เพื่อป้องกัน Desktop ไปผูกกับ daemon แบบไม่มี process containment.
- เพิ่ม 4 Desktop lifecycle tests ใน `apps/desktop/src/main/durable-daemon.test.ts`; MCP preview tests ของงานเดิมผ่าน 2 tests: รวม 6/6.
- เพิ่ม `scripts/smoke-durable-recovery.mjs`: จำลอง kill daemon ระหว่างงาน, restart, retry idempotency key เดิม, ตรวจ task ID เดิม, side effect เกิดครั้งเดียว, stdout ครบ; ผ่านกับ developer Node และ **Qnector.exe ที่แพ็กจริง**.
- `scripts/package-windows.ps1` ใช้ isolated candidate directory ไม่ลบ release เก่า, เพิ่ม regression tests, ตรวจ extraResources และรัน smoke/recovery ทั้ง developer bundle และ packaged executable. Build/setup/portable ชุดล่าสุดสำเร็จที่ `apps/desktop/release/durable-candidate-20260917-224826/`; `DURABLE_BUNDLE_SMOKE_PASSED` และ `DURABLE_PACKAGED_RECOVERY_PASSED`.
- Validation: `pnpm typecheck` PASS; `pnpm test` **279/279 tests (55 files)** PASS; `pnpm lint` PASS; `git diff --check` PASS. Windows packaging pipeline ผ่าน exit code 0 หลังเพิ่ม packaged recovery. ทดสอบใน isolated temp data roots ไม่รีสตาร์ต QNECTOR ที่ติดตั้ง.

### ยังไม่เสร็จ / ห้ามกล่าวว่า production-ready
- P2/P3 เป็น opt-in preview, ยังไม่มี Windows ACL audit ข้ามบัญชี, dedicated queued SQLite storage worker, complete secret-reference design หรือ lifecycle/upgrade drain ที่ยืนยันกับแอปที่ติดตั้งจริง. `QNECTOR_DURABLE_PREVIEW` ยังไม่ตั้ง default.
- P4 stdio/HTTP transport parity และ doctor, P5 workflow+resource lease convergence, P6 coding/search, P7 Jobs UI/optional agent, P8 migration/rollback/reboot/security/24-hour soak **ยังไม่ผ่านเงื่อนไขตามแผนเดิม**; ทดสอบ daemon kill อย่างเดียวไม่แทน full soak หรือ power loss.
- Current version `0.4.36` และ HEAD เดิม `fe1c7be`; working tree มี source จากอีกกระบวนการ + `pnpm-lock.yaml` churn หลายพันบรรทัด จึงยังไม่ได้ commit รวม, push, tag, release หรือ install. Build provenance ของ candidate ระบุ dirty tree; candidate ต้องไม่เผยแพร่เป็น stable.
- ไม่สามารถรับรองว่าจะลบอาการ ChatGPT Web `Connection interrupted`/`Message delivery timed out` ได้ทั้งหมด; job ที่รับเข้า daemon แล้วเท่านั้นที่ทำต่อได้เมื่อ frontend หลุด.

### ลำดับต่อไปที่ยังต้องทำ
1. แยก/รีวิว dirty tree และแก้ lockfile churn ก่อน commit โดยไม่แตะสามไฟล์เดิมจากอีกกระบวนการ; ใส่ commit checkpoint ที่ reproducible.
2. เพิ่ม Windows ACL/process handle containment/security review, service ownership, resource and storage budgets, secret protection; ทดสอบ packaged Desktop startup/close/upgrade โดยไม่รบกวน live instance.
3. Implement P4–P5 และ basic Jobs UI ให้ถึง release-first scope; เพิ่ม transport/workflow/reboot/soak/migration/rollback gates แล้วจึงพิจารณา bump version และ release.

## อัปเดต 18 กันยายน 2026 เวลา ~00:16 น. — ทดสอบแก้ ACL และ Windows Candidate

- เพิ่ม P4 แบบ opt-in: MCP stdio CLI และ HTTP ใช้ daemon เดียวกัน, schema parity, packaged stdio smoke และทดสอบ disconnect/reconnect ไม่ replay คำสั่ง. `tasks.doctor` อ่าน SQLite health โดยไม่เผยข้อมูลคำสั่ง. Desktop มี supervisor ที่เปิด daemon กลับเมื่อหลุด โดยไม่ kill worker เดิม.
- เพิ่ม Jobs UI preview ใน Runtime & Diagnostics ผ่าน IPC เฉพาะ workspace ปัจจุบัน: list, read stdout แบบ explicit, cancel ด้วย confirmation. เพิ่ม workspace isolation ใน MCP `tasks` get/wait/output/result/inspect/cancel และ Desktop; test ผ่าน.
- เพิ่ม `secureExecutionRoot` จำกัด ACL สำหรับ Windows journal/token ก่อน bind IPC, ปฏิเสธ unexpected ACE และทดสอบ explicit Everyone ACL. เจอบั๊กจริงที่การใช้ `icacls /inheritance:r /T` ทำให้ไฟล์เดิมไม่มี effective ACE, แก้ให้ grant กับ child ที่มีอยู่และตั้ง inheritable ACE ของ root สำหรับไฟล์ในอนาคต; ลดเวลา/ความขนานการทดสอบ release gate ให้เหมาะกับ ACL audit ที่เพิ่มเข้ามา ไม่ได้ข้าม tests.
- `pnpm test` ทุกโปรเจ็กต์ผ่าน **284/284 tests / 59 files**, `pnpm typecheck` ผ่าน, `pnpm lint` ผ่าน, `git diff --check` ผ่าน. Focused ACL/server/cancel/crash 6/6 ผ่าน. รอบ package แรกพบ regression under high parallelism และหยุดตาม gate; ปรับ `--maxWorkers=2`, แก้ test timeout ที่สั้นเกิน startup ACL, rerun focused tests ผ่าน.
- `scripts/package-windows.ps1` รอบล่าสุด exit 0 สร้าง `apps/desktop/release/durable-candidate-20260918-001344/` มี signed Setup+Portable. Test จาก packaged Qnector.exe: `DURABLE_BUNDLE_SMOKE_PASSED`, `DURABLE_PACKAGED_RECOVERY_PASSED`, `PACKAGED_STDIO_PARITY_PASSED`.
- QNECTOR ที่ติดตั้งใช้อยู่ยังไม่ได้ restart/update/install. ยังไม่ใช่ stable: WorkflowManager เดิมผูก lifetime กับ Desktop และ `shutdown()` จะ cancel active workflow; ยังไม่มี P5 workflow convergence/leases, tested migration+rollback/reboot/power-loss, cross-user Windows security test, 24h soak (1000 short/10 long), budget and secret design, successful installed-app upgrade/drain. P6 coding/search อาจเป็นรุ่นถัดไปตามแผน. Don't publish/tag/enable Preview by default until release-first gates completed.
- Working tree ยังมีงานคู่ขนานใน `session-bootstrap.ts`, `.test.ts`, `process-tool.ts`, untracked `comparekhaihub.txt`, และ `pnpm-lock.yaml` diff ขนาดใหญ่จากการ regenerate (quotes และ lock changes). ห้าม reset/clean/stage รวม, ต้อง review ก่อน commit. Gate package provenance candidate นี้เป็น dirty build, ห้ามเสนอเป็น stable release.

### Git checkpoint หลังทดสอบ
- Commit `7eccb2a` (`fix(durable): protect daemon journal ACL and validate recovery health`) บน `feat/durable-runtime-foundation` รวมเฉพาะ 7 ไฟล์ ACL/daemon/store/test ที่แยกได้ชัด (130 insertions / 10 deletions), cached diff check ผ่าน. งาน MCP/stdio/desktop/แพ็กเกจส่วนอื่นยังอยู่ใน working tree และยังไม่ได้ commit หรือเผยแพร่ เพราะมี lockfile churn และ concurrent unrelated changes; ต้องรักษาไว้ไม่ reset. **Commit นี้ไม่ใช่ tag หรือ GitHub Release**.

### อัปเดต Git หลังแก้ปัญหาและทดสอบ Frozen Lockfile (เวลา ~00:18 น.)
- `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts` สำเร็จด้วย pnpm 10.15.0 ครบ 10 workspace projects; lockfile ปัจจุบัน resolve ได้ แต่มี formatting churn หลายพันบรรทัดใน commit ที่ต้องพิจารณาทำให้น้อยลงในงาน maintenance ถัดไป.
- Commit `365d175` (`feat(durable): ship opt-in stdio parity desktop jobs and packaged recovery candidate`) รวม 29 ไฟล์ opt-in MCP stdio, daemon client, Desktop integration/Jobs, packaging smoke, lockfile และ qtok; `git diff --cached --check` ผ่านก่อน commit. **ยังไม่มี GitHub release/tag/push/upgrade production** และ release-first P5/P8 gates ไม่ครบ.
- ข้อความก่อนหน้าในเอกสารที่ว่า MCP/stdio/Desktop ยังไม่ commit เป็นสถานะก่อน commit นี้ ให้ใช้ส่วนนี้เป็นสถานะ Git ล่าสุด. เก็บ `session-bootstrap.ts`, `session-bootstrap.test.ts`, `process-tool.ts` และ `comparekhaihub.txt` ที่ไม่เกี่ยวข้องไว้ใน working tree โดยไม่ stage หรือ reset.

### 18 ก.ย. 2026 ~00:43 — MCP timeout/connection hardening (scope เฉพาะ mitigation)
- เพิ่ม Streamable HTTP MCP conditional SSE comment heartbeat ทุก 15s เฉพาะเมื่อ headers ยืนยัน `text/event-stream`, response ไม่ปิด, ไม่ติด backpressure และอยู่ที่ SSE frame boundary (`\n\n`); เก็บ Content-Type จาก `writeHead` ด้วย เพื่อไม่ทำ JSON-RPC/stdio ผิดรูป. Heartbeat นี้แก้เฉพาะ idle SSE ไม่ใช่ ChatGPT model stream timeout และไม่แก้ SSE ที่ยังไม่ได้ส่ง headers.
- เพิ่ม MCP result budget JSON 256KiB, image base64 2MiB: ส่งสรุป/สถานะเดิมและ task handles/cursor, ระบุ `payloadOmitted`/`imageOmitted` และคำแนะนำให้ขอหน้าเล็ก; ห้าม replay mutating tool เพราะ response ใหญ่. ไม่ใช่ระบบ paging ใหม่สำหรับ output ที่ไม่มี cursor อยู่แล้ว.
- ปรับ opt-in `tasks.start` คืน durable taskId ทันทีเป็น default (ยังขอ wait สูงสุด 5s ได้) ด้วย stable idempotency key, `tasks.wait/result/output` สำหรับตามผล. Legacy 8 tools ยังไม่ถูกเปลี่ยนเป็น background execution โดยอัตโนมัติ.
- stdio CLI ติดตั้ง log guard ก่อน dynamic import runtime: `console.log/info/debug/warn` ไป stderr เท่านั้น; stdout ปล่อยให้ JSON-RPC transport ใช้. Tests HTTP origin/modern protocol, actual HTTP oversized response one call, stdio parity, frontend disconnect และ incomplete SSE frame.
- ระหว่าง package พบ ACL startup race เมื่อ worker เปลี่ยนชื่อไฟล์ `worker-identity.json.*.tmp` หลัง PowerShell enumerate: `Get-Acl` หา path ไม่พบ, daemon ออกจากโปรเซสและ test teardown EPERM. แก้ `private-root.ts` ข้ามเฉพาะ child ที่ตรวจแล้วไม่มีอยู่จริงหลัง Get-Acl error; root/ACL failure บนไฟล์ที่ยังมีอยู่ต้อง fail closed. Focused crash/cancel/private-root 4/4 ผ่าน.
- ผลล่าสุดหลังแก้ทุกจุด: `pnpm test` **291/291 tests / 61 files** ผ่าน, `pnpm typecheck` ผ่าน, `pnpm lint` ผ่าน. `scripts/package-windows.ps1` latest exit 0 หลังผ่าน regression gates; candidate `apps/desktop/release/durable-candidate-20260918-004027/` signed Setup+Portable และ markers `DURABLE_BUNDLE_SMOKE_PASSED`, `DURABLE_PACKAGED_RECOVERY_PASSED`, `PACKAGED_STDIO_PARITY_PASSED`.
- Candidate นี้สร้างจาก **dirty working tree** ก่อน commit, อย่าอ้างว่าตรง HEAD commit ใหม่โดยตรง. QNECTOR ตัวที่ติดตั้งไม่ถูก restart/install. P5 workflow convergence, reboot/migration/rollback, cross-account ACL, 24-hour soak ยังไม่เสร็จ จึงห้ามเรียก stable หรือ publish release. รักษา unrelated `session-bootstrap.*`, `process-tool.ts`, `comparekhaihub.txt` ไว้.
