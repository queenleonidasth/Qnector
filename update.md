# Qnector — Feasibility Assessment & Implementation Handoff

> วันที่ประเมิน: 29 สิงหาคม 2026  
> เอกสารต้นทาง: `recommend.md`  
> Product source of truth ปัจจุบัน: `../devq.md`  
> เป้าหมายของเอกสารนี้: ให้ AI/DEV ตัวถัดไปนำไปพัฒนาต่อได้โดยอิงกับโค้ดจริงใน repository นี้

---

## 1. บทสรุปการประเมิน

ข้อเสนอใน `recommend.md` **สามารถพัฒนาได้เกือบทั้งหมด** บนสถาปัตยกรรมปัจจุบัน โดยไม่ต้องรื้อ Qnector ใหม่ โครงสร้าง monorepo, headless MCP runtime, grouped tools, Electron main/preload/renderer, activity logger และ process manager ที่มีอยู่รองรับการต่อยอดได้ดี

อย่างไรก็ตาม มี 4 ประเด็นที่ต้องแก้ความหมายก่อนลงมือ:

1. `devq.md` ระบุว่า MCP ต้องมี **5 grouped tools เท่านั้น** แต่ roadmap เสนอ `memory` และ `browser` เพิ่ม จึงต้องแก้ `devq.md`, tool-reference และ tests อย่างตั้งใจก่อนเพิ่ม tool ที่ 6/7 ห้ามเพิ่มเงียบ ๆ
2. Qnector ไม่มี model API ตาม product principle ดังนั้น `memory.compact` และการอัปเดต `MEMORY.md` ต้องเป็น deterministic compaction/event ledger หรือรับข้อความสรุปที่ AI ผู้เรียกส่งมาให้ ห้ามอ้างว่า Qnector สรุปเชิงความหมายด้วย AI ได้เอง
3. Qnector ไม่สามารถบังคับ ChatGPT ให้เรียก `workspace.summary` ตอนเปิดแชทใหม่ได้ ทำได้เพียงแนบ memory ทุกครั้งที่ action นี้ถูกเรียก และจัด MCP Resources/prompt เริ่มต้นให้ค้นพบง่าย
4. Screen capture, window focus และ Browser DevTools เดิมถูกจำกัดไว้ที่การดูหน้าจอ/focus/localhost diagnostics; capability roadmap วันที่ 29 สิงหาคม 2026 ขยาย scope เพิ่ม **semantic Windows UI Automation สำหรับ local desktop apps** อย่างตั้งใจ แต่ยังห้าม raw pixel-coordinate mouse control, general-purpose synthetic mouse/keyboard computer-use, remote desktop และการ attach/ควบคุม ChatGPT session

### ผลประเมินรายกลุ่ม

| กลุ่มงาน                         | ความเป็นไปได้                   | ความเสี่ยง | ข้อสรุป                                                                      |
| -------------------------------- | ------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| Persistent Memory Layer 1–2      | สูง                             | กลาง       | ควรทำก่อนและให้เป็น milestone แรก                                            |
| Memory Drawer / Export / Pruning | สูง                             | ต่ำ–กลาง   | ทำต่อจาก core memory ได้ตรง ๆ                                                |
| `.qnector/MEMORY.md`             | สูงในแบบ event ledger           | กลาง       | ห้ามอ้างว่า auto-summary เชิงความหมายโดยไม่มีโมเดล                           |
| Secret Sanitizer                 | สูงแบบ best-effort              | กลาง       | ต้องใช้กับ memory และ activity log ไม่ใช่ memory อย่างเดียว                  |
| MCP Resources                    | สูง                             | ต่ำ        | SDK ที่ติดตั้งรองรับ `registerResource` แล้ว                                 |
| Smart Log Reducer                | สูง                             | กลาง       | ควรเก็บ head + diagnostics + tail ไม่ใช่ตัดเฉพาะต้น output                   |
| Clipboard / Toast                | สูง                             | ต่ำ        | Electron มี API อยู่แล้ว; ต้องมี headless adapter ด้วย                       |
| Global Shortcut                  | สูง                             | ต่ำ        | Electron รองรับ `globalShortcut` โดยตรง                                      |
| Activity Export                  | สูง                             | ต่ำ        | JSONL เดิมเป็นฐานข้อมูลได้ทันที                                              |
| Screen Capture                   | สูงใน Electron, กลางใน headless | กลาง       | ต้องคืน MCP image content ไม่ใช่ยัด base64 ลง JSON text                      |
| Window List / Focus              | กลาง                            | กลาง–สูง   | ต้องใช้ Windows native/PowerShell adapter และ handle OS focus restrictions   |
| Browser DevTools localhost       | กลาง–สูง                        | กลาง       | ใช้ CDP กับ browser profile แยกและ debug port ที่ผู้ใช้เปิดเอง               |
| Semantic/Vector Search           | ทำได้แต่ยังไม่ควรเป็น MVP       | สูง        | ต้องทำ spike เรื่อง local embedding, native packaging และขนาด installer ก่อน |

### Baseline ที่ตรวจแล้ว

- Repository ใช้ Node.js/TypeScript/pnpm workspace ตาม `devq.md`
- MCP runtime ปัจจุบันประกาศ 5 tools: `system`, `workspace`, `files`, `process`, `git`
- `workspace.summary` มีจุดต่อยอดที่ `packages/tools/src/workspace-tool.ts`
- MCP registration อยู่ที่ `packages/mcp-server/src/server.ts`
- Desktop IPC และ UI อยู่ที่ `apps/desktop/src/main/main.ts`, `src/preload/*`, `src/renderer/renderer.tsx`
- Electron main ใช้ `clipboard` อยู่แล้วสำหรับ Copy MCP URL แต่ยังไม่มี MCP clipboard actions
- Process output มี hard cap/ring buffer แต่ยังไม่มี smart diagnostic reduction
- Activity log เป็น JSONL และมี in-memory list แต่ยังไม่มี export UI
- MCP runtime ปัจจุบัน migrate เป็น modular SDK v2 (`@modelcontextprotocol/server@2.0.0` + `@modelcontextprotocol/node@2.0.0`) แล้ว; v1 monolithic `@modelcontextprotocol/sdk` ถูกถอดออก
- ณ วันประเมิน: `typecheck`, unit/integration tests 5 tests และ `lint` ผ่านทั้งหมด
- โฟลเดอร์ snapshot นี้ไม่มี `.git` directory จึงห้าม AI ผู้พัฒนาพึ่ง `git diff/status` เพื่อรักษางานเดิม ต้องอ่านไฟล์ก่อนแก้และตรวจผลด้วย file comparison/test

---

## 2. ขอบเขตและข้อกำหนดที่ห้ามละเมิด

ทุก phase ต้องรักษากติกาเดิมต่อไปนี้:

- Headless MCP ต้องรันได้โดยไม่เปิด Electron
- ห้ามเพิ่ม approval queue, RBAC, sandbox, command allowlist หรือทำ active workspace เป็น access boundary
- ห้ามเรียก OpenAI model API เพื่อสร้าง summary/embedding โดยปริยาย
- ห้ามเก็บ ChatGPT cookie/token และห้าม automate หน้า ChatGPT
- Browser CDP ต้องอนุญาตเฉพาะ target ที่ URL เป็น `localhost`, `127.0.0.1` หรือ `[::1]` ใน v1
- Screen/window baseline เดิมห้าม input automation; ข้อกำหนดนี้ถูก supersede บางส่วนโดย roadmap วันที่ 29 สิงหาคม 2026: อนุญาต semantic Windows UI Automation (`invoke`, `set_value`, `focus`, `select`, bounded `wait`) สำหรับ local desktop apps แต่ยังห้าม raw coordinate click/mouse movement, general-purpose synthetic typing และ remote desktop control
- Tool annotations ต้องบอกพฤติกรรมจริง แม้ client อาจแสดง confirmation
- ข้อมูล memory ต้อง local-only ในความหมายว่า Qnector ไม่ส่งไปบริการภายนอก ทั้งนี้ OS backup/sync ของผู้ใช้เป็นเรื่องนอกขอบเขตแอป
- ทุก output ที่อาจใหญ่ต้องมี limit/cursor/truncation metadata
- ทุก write ต้อง atomic เมื่อทำได้ และมี automated tests สำหรับ failure/concurrency

### การแก้ source of truth ที่จำเป็น

ก่อนเริ่ม Memory Phase ให้แก้ `../devq.md` อย่างชัดเจนในหัวข้อ tool surface, tests, non-goals และ final decisions ดังนี้:

- เปลี่ยนจาก “exactly 5 primary tools” เป็น “6 grouped tools เมื่อ Memory Phase เสร็จ”
- เพิ่ม `memory` เป็น grouped tool ที่ 6
- `browser` เพิ่มใน Browser Phase เป็น grouped tool ที่ 7; roadmap expansion วันที่ 29 สิงหาคม 2026 เพิ่ม semantic Windows UI Automation เป็น `computer` grouped tool ที่ 8 หลัง reconcile `devq.md` แล้ว
- อนุญาต screen capture/window inspection แบบไม่ควบคุม input
- อนุญาต CDP สำหรับ dedicated local-development browser profile เท่านั้น และยืนยันข้อห้าม ChatGPT automation

หากยังไม่ได้รับอนุญาตให้แก้ `devq.md` ให้หยุดเฉพาะการเพิ่ม tool ใหม่ แต่สามารถทำ MemoryStore, sanitizer, UI prototype และ tests ภายในได้

---

## 3. สถาปัตยกรรมเป้าหมาย

### 3.1 Tool surface ที่แนะนำ

หลัง Memory Phase:

1. `system` — เพิ่ม actions `clipboard_read`, `clipboard_write`, `toast`, `screen_capture`, `window_list`, `window_focus`
2. `workspace` — `summary` แนบ last memory state อัตโนมัติ
3. `files`
4. `process`
5. `git`
6. `memory` — `recall`, `save_checkpoint`, `note`, `list`, `get`, `set`, `delete`, `compact`, `clear`, `export`

หลัง Browser Phase จึงเพิ่ม:

7. `browser` — `status`, `targets`, `console`, `network_errors`, `reload`, `screenshot`, `dom_snapshot`, `query`, `inspect`, `computed_style`, `evaluate`, `requests`, `performance`

การรวม clipboard/screen/window ไว้ใต้ `system` รักษาหลัก “few coherent grouped tools” และไม่ทำให้ tool catalog บวม ชื่อใน `recommend.md` เช่น `screen.capture` ให้ตีความเป็น `system({ action: "screen_capture" })`

### 3.2 Runtime dependency injection

ห้าม import Electron เข้า `packages/core`, `packages/tools` หรือ `packages/mcp-server` ให้สร้าง abstraction:

```ts
interface PlatformServices {
  capabilities(): PlatformCapabilities;
  readClipboard(): Promise<ClipboardPayload>;
  writeClipboard(input: ClipboardWriteInput): Promise<void>;
  showToast(input: ToastInput): Promise<void>;
  captureScreen(input: ScreenCaptureInput): Promise<ImageAttachment>;
  listWindows(): Promise<WindowInfo[]>;
  focusWindow(id: string): Promise<void>;
}
```

- Electron runtime: implement ใน `apps/desktop/src/main/platform-services.ts` ด้วย Electron APIs
- Headless Windows runtime: implement ใน `packages/core/src/windows-platform-services.ts` ด้วย PowerShell/Win32-compatible mechanisms
- OS ที่ยังไม่รองรับ: คืน error code `UNSUPPORTED_CAPABILITY` พร้อม `capabilities()` ที่สะท้อนความจริง
- `QnectorRuntime` รับ `platformServices?` ผ่าน constructor แล้วส่งต่อใน `ToolContext`

### 3.3 Binary/image result contract

ปัจจุบัน MCP server คืนเฉพาะ JSON text + `structuredContent` ซึ่งไม่เหมาะกับ screenshot ให้เพิ่มชนิดกลางที่ไม่ผูกกับ SDK:

```ts
interface ToolAttachment {
  type: "image";
  mimeType: "image/png" | "image/jpeg";
  dataBase64: string;
}

interface ToolResult<T = unknown> {
  // fields เดิม
  attachments?: ToolAttachment[];
}
```

`packages/mcp-server` เป็นผู้ map attachment เป็น MCP image content และต้องไม่ serialize `dataBase64` ซ้ำลง text/structured JSON ให้ text เหลือ metadata เช่น display/window, dimensions, mime type และ byte size

---

## 4. Persistent Memory — รายละเอียด implementation

### 4.1 Canonical storage

ให้ canonical data อยู่ภายนอก workspace:

```text
%APPDATA%\Qnector\memory\
├─ index.json
└─ <workspaceId>\
   ├─ state.json
   ├─ checkpoints.jsonl
   └─ exports\              # optional; เฉพาะเมื่อผู้ใช้ export
```

- `workspaceId` เป็น UUID ที่ map กับ normalized real path ใน `index.json`
- Windows path comparison ต้อง case-insensitive และ resolve ด้วย `realpath` เมื่อ path มีอยู่
- เมื่อ workspace ถูกย้าย path แล้วระบบหา memory เดิมไม่พบ ให้ UI มี `Import/Attach existing memory` ในอนาคต ห้ามเดาจากชื่อ folder อย่างเดียว
- เขียน JSON ผ่าน temp file + rename
- serialize mutations ต่อ workspace ด้วย promise queue/mutex เพื่อกัน MCP concurrent calls เขียนทับกัน
- จำกัด input string, จำนวน facts/checkpoints และ file size ด้วย schema

ไม่แนะนำให้ใช้ SQLite ใน Memory MVP เพราะ JSON/JSONL เพียงพอกับข้อมูลระดับเล็กและไม่เพิ่ม native packaging burden; SQLite ค่อยใช้ใน semantic index phase

### 4.2 State schema v1

เพิ่ม Zod schema และ TypeScript types ใน `packages/shared`:

```ts
interface MemoryStateV1 {
  version: 1;
  workspaceId: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  active: {
    currentTask: string;
    completedSteps: string[];
    pendingSteps: string[];
    criticalContext: string;
  } | null;
  facts: Array<{
    id: string;
    key: string;
    category: "fact" | "decision" | "rule" | "note";
    value: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  recentChanges: Array<{
    timestamp: string;
    source: "files" | "git" | "manual";
    summary: string;
    paths: string[];
  }>;
}
```

Checkpoint record ต้องมี `id`, `createdAt`, active-state snapshot และ optional `label`; เก็บ rolling 10 records เป็นค่าเริ่มต้น

### 4.3 `memory` actions

| Action            | Input สำคัญ                                                                  | Behavior                                                                                          |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `recall`          | `checkpointLimit?`, `factLimit?`                                             | คืน active state, facts และ checkpoint ล่าสุดแบบจำกัดขนาด                                         |
| `save_checkpoint` | `currentTask`, `completedSteps`, `pendingSteps`, `criticalContext`, `label?` | sanitize, update active state, append snapshot, prune ให้เหลือ 10                                 |
| `note`            | `key`, `value`, `category?`, `tags?`                                         | upsert note/fact แบบ key ชัดเจน                                                                   |
| `list`            | `category?`, `query?`, `limit`, `cursor`                                     | คืน metadata/preview พร้อม pagination                                                             |
| `get`             | `id?` หรือ `key?`                                                            | คืน record เดียว                                                                                  |
| `set`             | record ที่ validate แล้ว                                                     | upsert แบบ explicit; แยกจาก `note` เพื่อรองรับ UI edit                                            |
| `delete`          | `id?` หรือ `key?`                                                            | ลบ record เดียว; destructive                                                                      |
| `compact`         | `keepCheckpoints?`, `replacementSummary?`                                    | deterministic dedupe/prune; ถ้ามี summary เชิงความหมาย AI ผู้เรียกต้องส่ง `replacementSummary` มา |
| `clear`           | `scope: active                                                               | checkpoints                                                                                       | facts                                                                         | all` | ล้างเฉพาะ workspace ปัจจุบัน; destructive |
| `export`          | `format: json                                                                | markdown`, `path?`                                                                                | คืน preview หรือเขียนไฟล์ที่ผู้ใช้เลือก; ห้ามรวม secret ที่ sanitizer ตัดแล้ว |

ข้อกำหนด:

- ทุก response มี `workspaceId`, `updatedAt`, counts และ truncation metadata
- `clear` ไม่ต้องมี local approval layer แต่ schema ต้องบังคับ `scope` ให้ explicit และ annotation/description ต้องบอกว่า destructive
- ห้ามรับ arbitrary workspace ID จาก client เพื่ออ่าน memory อื่น ให้ derive จาก active workspace
- `memory.recall` ต้องไม่คืน checkpoint history ทั้งหมดโดย default
- ทดสอบ concurrent `set/save_checkpoint` ว่าไม่มี lost update

### 4.4 Secret Sanitizer

สร้าง `packages/core/src/secret-sanitizer.ts` และใช้ก่อน:

- memory write ทุก action
- activity `argsSummary`
- activity export
- `MEMORY.md` mirror
- browser console/network export

อย่างน้อยต้องตรวจ:

- key names: `token`, `password`, `secret`, `apiKey`, `authorization`, `cookie`, `privateKey`, `clientSecret`
- common token formats: Bearer, GitHub tokens, OpenAI-style keys, AWS access/secret, PEM private keys, JWT
- URL credentials และ connection strings
- high-entropy candidate ที่ยาวเกิน threshold โดยใช้ conservative rules เพื่อลด false positive

แทนค่าด้วย `[REDACTED_SECRET]`; ห้ามเก็บ raw value ใน log/error ก่อน sanitize และต้องมี tests ทั้ง true positive/false positive

เอกสาร/UI ต้องใช้คำว่า **best-effort secret sanitization** ห้ามรับประกันว่า “ตรวจ secret ได้ 100%”

### 4.5 `workspace.summary` bootstrapping

แก้ `projectSummary`/summary path ให้ผลลัพธ์มี:

```json
{
  "...existing": "...",
  "memory": {
    "available": true,
    "lastCheckpointAt": "...",
    "currentTask": "...",
    "pendingSteps": [],
    "criticalContext": "...",
    "coreFacts": []
  }
}
```

- จำกัด memory block ไม่เกินประมาณ 8–12 KB โดย config
- ถ้าไม่มี memory ให้คืน `available: false` โดยไม่สร้าง checkpoint เปล่า
- summary ต้องยังทำงานเมื่อ MemoryStore เสีย/ไฟล์ corrupt โดยคืน warning ไม่ทำให้ workspace summary ล้มทั้ง action
- ระบุใน docs ว่า “injected whenever `workspace.summary` is called” ไม่ใช่ “ChatGPT จะเรียกอัตโนมัติเสมอ”

### 4.6 `.qnector/MEMORY.md`

ให้เป็น optional readable mirror ไม่ใช่ canonical database:

- config `memory.workspaceMirror: "off" | "memory-md"`, default แนะนำ `off` เพื่อไม่สร้าง untracked file โดยไม่บอกผู้ใช้
- เมื่อเปิด ให้ regenerate จาก sanitized state หลัง memory mutation สำเร็จ
- sections: Current Task, Pending Steps, Completed Steps, Critical Context, Core Facts, Recent Qnector Changes, Last Updated
- Qnector บันทึก event จาก mutation ที่ผ่าน `files` และ `git.commit` ของ Qnector ได้ แต่ไม่ควรอ้างว่าเข้าใจ semantic meaning ของ diff
- การแก้ไฟล์จากโปรแกรมอื่นจะไม่ถูกสรุปอัตโนมัติใน MVP; filesystem watcher เป็นงานแยก
- UI แสดงคำแนะนำเพิ่ม `.qnector/` ลง `.gitignore` แต่ห้ามแก้ `.gitignore` อัตโนมัติ

### 4.7 Memory UI

เพิ่ม drawer/tab ใหม่ใน renderer:

- Active task + last checkpoint
- Pending tasks
- Facts แยก category: decisions, rules, facts, notes
- Checkpoint history 10 รายการ
- Direct edit/save/delete
- `Compact`, `Wipe`, `Export`
- confirm dialog เฉพาะ UI สำหรับ Wipe เพื่อกันคลิกพลาด (นี่เป็น UX guard ไม่ใช่ MCP approval system)
- แสดง timestamp และ badge เมื่อ content ถูก sanitizer
- IPC ทุกตัวต้อง typed ใน `apps/desktop/src/preload/api.ts`

---

## 5. MCP Resources

ลงทะเบียน resource ต่อ `McpServer` session ใน `createMcpServer()`:

- `qnector://workspace/status` — server status, active workspace, Git summary แบบสั้น และ running process count
- `qnector://memory/latest` — sanitized active state + core facts + last checkpoint metadata

ข้อกำหนด:

- ใช้ API จาก SDK version ที่ติดตั้งจริง (`registerResource`) และห้ามคัด API จากความจำ
- callback ต้องอ่าน current runtime state ทุกครั้ง ไม่ cache ตอนสร้าง session
- MIME type แนะนำ `application/json`
- จำกัด payload เหมือน tools
- เพิ่ม integration tests สำหรับ `resources/list` และ `resources/read`
- Resource เป็นช่องทางให้อ่านบริบท ไม่ใช่กลไก push เข้า ChatGPT อัตโนมัติ

---

## 6. Windows/System Capabilities

### 6.1 Clipboard

เพิ่ม `system` actions:

- `clipboard_read`: text ก่อน; file list เป็น phase ต่อไปถ้า Electron/Windows API คืนได้สม่ำเสมอ
- `clipboard_write`: text และ optional HTML ใน Electron adapter

ข้อควรระวัง:

- จำกัดขนาดข้อความและรายงาน truncation
- activity log ห้ามเก็บ clipboard content เต็ม ให้เก็บเฉพาะ type/length/hash
- headless Windows ใช้ PowerShell `Get-Clipboard`/`Set-Clipboard`; Electron ใช้ `clipboard`

### 6.2 Toast

เพิ่ม `system({ action: "toast", title, body, silent? })`:

- Electron adapter ใช้ `Notification`
- validate title/body length
- headless adapter อาจคืน `UNSUPPORTED_CAPABILITY` จนกว่าจะมี Windows implementation ที่เชื่อถือได้
- ห้าม trigger toast อัตโนมัติจากทุก command ใน MVP; ให้ AI เรียก หรือเพิ่ม user setting “notify on long task completion” ภายหลัง

### 6.3 Screen capture

เพิ่ม `system({ action: "screen_capture", source: "primary"|"screen"|"window", sourceId?, format?, maxWidth? })`

- Electron ใช้ `desktopCapturer.getSources`
- ให้ `window_list`/capture source list คืน source IDs ที่ใช้ต่อได้
- encode PNG เป็น default และ resize เพื่อจำกัด payload
- MCP response ต้องเป็น image content ตามหัวข้อ 3.3
- ถ้า OS permission/capture session ใช้ไม่ได้ ให้คืน actionable error
- ห้ามบันทึก screenshot ลง disk โดย default; เขียนไฟล์เฉพาะเมื่อ client ส่ง explicit `path`

### 6.4 Window list/focus

Electron เห็นหน้าต่างของ Qnector เองได้ แต่ไม่ enumerate ทุก native window จึงต้องมี Windows adapter:

- list เฉพาะ process ที่มี non-zero `MainWindowHandle`
- คืน stable call-scoped ID, title, process name, PID, bounds เมื่อหาได้
- focus ใช้ native `SetForegroundWindow`/restore minimized window ผ่าน PowerShell helper หรือ small reviewed native helper
- handle กรณี Windows ปฏิเสธ foreground focus ด้วย `WINDOW_FOCUS_DENIED`
- ห้ามใช้ title อย่างเดียวเป็น identifier เพราะซ้ำและเปลี่ยนได้

---

## 7. Smart Token & Log Reduction

ปัจจุบัน `ProcessManager.run()` เก็บเฉพาะต้น output เมื่อเกิน `maxChars` ทำให้ final summary ท้าย log อาจหาย ให้เปลี่ยนเป็น bounded collector:

1. strip ANSI/progress control noise สำหรับ reduced view
2. เก็บ head block
3. เก็บ diagnostic windows รอบบรรทัดที่ match เช่น `error`, `failed`, `exception`, stack frame, compiler diagnostic
4. เก็บ tail block เสมอ
5. deduplicate progress lines ที่เขียนซ้ำ
6. คืน `omittedChars`, `omittedLines`, `originalSize`, `sha256`, `reductionMode`

เพิ่ม input `outputMode: "raw" | "smart"`, default `smart` สำหรับ `process.run`; `process.output` ของ background process ยังคง cursor/raw semantics เดิมและลดเฉพาะ page ที่ client ขอเมื่อระบุ `smart`

ห้ามใช้ regex reducer ลบ raw ring buffer ก่อนผู้ใช้มีโอกาสอ่าน และต้องมี fixtures สำหรับ npm/pnpm, TypeScript, Vitest และ generic stack trace

---

## 8. Desktop UX/DX เพิ่มเติม

### Global shortcut

- register `Ctrl+Shift+Q` หลัง `app.whenReady()`
- shortcut ทำ toggle show/hide + focus
- unregister ใน shutdown
- ถ้า register ไม่สำเร็จให้แสดง warning ใน Settings และ allow user configure/disable
- เพิ่ม config schema `ui.globalShortcut` และ `ui.globalShortcutEnabled`

### Activity export

- เพิ่ม `ActivityLogger.list/filter` และ export service
- format `json` และ `markdown`
- UI ใช้ save dialog เลือก path
- export ต้อง sanitize ซ้ำ และรองรับ date/tool/status filters
- ไม่ต้องสร้าง compliance/audit subsystem

### UI architecture

`renderer.tsx` เริ่มใหญ่แล้ว ก่อนเพิ่ม Memory/Activity drawers ควรแยกอย่างน้อย:

```text
apps/desktop/src/renderer/
├─ App.tsx
├─ components/
│  ├─ MemoryDrawer.tsx
│  ├─ ActivityDrawer.tsx
│  ├─ WorkspaceDrawer.tsx
│  └─ SettingsDrawer.tsx
└─ hooks/useQnector.ts
```

ห้าม refactor CSS/visual theme ครั้งใหญ่ใน commit เดียวกับ MemoryStore; แยก phase เพื่อ debug ง่าย

---

## 9. Browser DevTools Bridge

ทำหลัง memory/system phases เสถียรแล้วเท่านั้น

### Safe scope ของ v1

- Qnector launch หรือ attach Chrome/Edge ที่เปิดด้วย `--remote-debugging-port`
- ถ้า Qnector เป็นผู้ launch ให้ใช้ dedicated `--user-data-dir` ใต้ Qnector data directory ห้ามใช้ profile หลักของผู้ใช้
- target allow rule: page URL ต้องเป็น localhost/loopback เท่านั้น
- actions: targets/status, console/network errors, reload, screenshot, bounded DOM/CSS inspection, read-only bounded evaluate, header/body-free request summaries, and selected performance metrics/timing
- ห้าม navigate ไป arbitrary external URL, กรอกฟอร์ม, click/type, อ่าน cookie/storage/credentials หรือ attach target ของ ChatGPT; `evaluate` ต้องเปิด CDP side-effect detection และ reject direct storage/credential APIs

ใช้ HTTP discovery endpoint ของ CDP และ `ws` ที่มีอยู่แล้ว ไม่ต้องเพิ่ม Playwright/Puppeteer ใน MVP

Tests ใช้ mocked CDP server และ integration test กับ local fixture page; ห้ามให้ CI ต้องเปิด browser จริงทุกครั้ง

---

## 10. Semantic Search — Future Spike

อย่าเริ่มด้วย SQLite-VSS/LanceDB ทันที ให้แยกเป็น 3 ขั้น:

1. lexical index: file metadata + symbols + SQLite FTS/FlexSearch เพื่อพิสูจน์ chunking/incremental update
2. embedding provider interface ที่ไม่มี network dependency
3. ทดลอง local ONNX embedding model และวัด installer size, startup time, RAM, indexing time, Electron packaging

ต้องตัดสินใจก่อน production:

- supported languages/file types
- ignore rules (`.gitignore`, binary, generated files, secrets)
- chunk identity/invalidation เมื่อไฟล์เปลี่ยน
- index location/quota/pruning
- local embedding license/model size
- fallback เมื่อ native/vector dependency load ไม่ได้

`memory.search` ควรเพิ่มเมื่อมี benchmark ว่าแม่นกว่า `workspace.grep` อย่างมีนัยสำคัญ ไม่เช่นนั้นให้คง lexical search เพื่อหลีกเลี่ยงความซับซ้อนและ installer บวม

---

## 11. ลำดับการพัฒนาที่แนะนำ

### Phase A0 — Contract update

- แก้ `devq.md` และ `docs/tool-reference.md`
- เพิ่ม config/type/schema migrations แบบ backward-compatible
- เพิ่ม tests สำหรับ config เก่าที่ยัง load ได้

Exit: source of truth ไม่ขัดกับ tool count/scope ใหม่

### Phase A1 — Memory core

สร้าง/แก้:

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/core/src/memory-store.ts` (ใหม่)
- `packages/core/src/secret-sanitizer.ts` (ใหม่)
- `packages/core/src/config.ts`
- `packages/core/src/index.ts`
- core unit tests ใหม่

Exit: atomic CRUD, checkpoint pruning, sanitizer และ concurrent writes ผ่าน tests

### Phase A2 — Memory MCP + workspace bootstrap

สร้าง/แก้:

- `packages/tools/src/memory-tool.ts` (ใหม่)
- `packages/tools/src/index.ts`
- `packages/tools/src/tool-result.ts`
- `packages/tools/src/workspace-tool.ts`
- `packages/mcp-server/src/server.ts`
- tool/MCP integration tests

Exit: tools/list เห็น 6 grouped tools, ทุก memory action ทำงาน, `workspace.summary` คืน memory block และ corrupt store ไม่ทำให้ summary ล้ม

### Phase A3 — MCP Resources

- register/read 2 resources
- resource payload size limits
- integration tests `resources/list/read`

Exit: MCP client อ่าน resource ได้จาก session ใหม่และเห็น current state จริง

### Phase A4 — Memory UI + mirror/export

- typed IPC
- Memory drawer CRUD
- compact/wipe/export
- optional `MEMORY.md` mirror

Exit: UI edit สะท้อนใน MCP recall และ restart แอปแล้วข้อมูลยังอยู่

### Phase B1 — Log reducer + activity export

- bounded smart collector
- sanitizer ครอบ activity
- JSON/Markdown export

Exit: log ขนาดใหญ่ยังเห็น error และ final test summary โดย response ไม่เกิน configured cap

### Phase B2 — Clipboard, toast, shortcut

- PlatformServices abstraction
- Electron/headless capability adapters
- system actions + typed IPC/settings

Exit: headless runtime ไม่ import Electron; desktop actions ทำงานจริงบน Windows

### Phase C — Screen/window

- image attachment contract
- screen capture
- native window list/focus
- Windows manual acceptance matrix หลาย display/DPI/minimized window

Exit: ChatGPT/MCP client ได้ image content ที่เปิดดูได้ และ focus failure มี error ชัดเจน

### Phase D — Browser DevTools

- แก้ source-of-truth ให้มี tool ที่ 7
- dedicated profile launcher/CDP client
- localhost target filter
- console/network/reload + screenshot/DOM/CSS actions
- bounded read-only evaluate, header/body-free request summaries, selected performance metrics/timing

Exit: inspect fixture localhost ได้, screenshot/DOM/advanced diagnostics ผ่าน real Chrome acceptance และ test ยืนยันว่าปฏิเสธ external/ChatGPT targets รวมถึง storage/credential access ผ่าน evaluate

### Phase E — Search spike

- benchmark lexical vs vector
- packaging/size/performance report
- ตัดสินใจ go/no-go ก่อน merge production implementation

---

## 12. Test plan ที่ต้องเพิ่ม

### Memory/core

- first-run store creation
- path normalization และ workspace isolation
- atomic write/recovery จาก corrupt temp/state file
- simultaneous save/set ไม่มี lost update
- rolling checkpoint เหลือ 10
- compact dedupe/prune และ user-provided replacement summary
- clear ราย scope
- export/import round trip
- sanitizer token patterns, nested values, false positives
- input/payload size limits

### MCP

- tools/list ชื่อและ schema ใหม่
- memory CRUD ผ่าน tools/call
- honest destructive annotations/descriptions
- summary bootstrap with/without/corrupt memory
- resources list/read และ payload limits
- screenshot maps เป็น MCP image content โดยไม่มี base64 ซ้ำใน text

### Desktop

- typed IPC memory CRUD/export
- renderer state update หลัง workspace switch
- wipe confirmation
- global shortcut register failure
- clipboard text round trip
- toast capability handling
- capture primary/specific source
- window focus success/failure

### Logs/browser

- smart reducer รักษา head/error/tail
- ANSI/progress noise
- activity export sanitization
- CDP reconnect/target gone
- localhost allow + external target deny
- browser process cleanup โดยไม่แตะ browser ที่ Qnector ไม่ได้ launch

### คำสั่ง validation ทุก phase

```powershell
npx pnpm@10.15.0 lint
npx pnpm@10.15.0 typecheck
npx pnpm@10.15.0 test
npx pnpm@10.15.0 smoke:mcp
```

เมื่อแก้ Electron/native/package dependencies ให้รันเพิ่ม:

```powershell
npx pnpm@10.15.0 package:windows
```

และทดสอบ portable/setup artifact บน Windows แบบ manual อย่างน้อยหนึ่งรอบ

---

## 13. Acceptance scenarios

### Cross-chat resume

1. ตั้ง active workspace
2. เรียก `memory.save_checkpoint` พร้อม task/completed/pending/context
3. ปิด MCP session และเปิด session ใหม่
4. เรียก `workspace.summary`
5. ต้องเห็น task/pending/context เดิมโดยไม่อ่าน checkpoint ทั้งหมด

### Privacy

1. ส่ง fake API key/password/JWT ใน nested memory payload
2. ตรวจ `state.json`, `checkpoints.jsonl`, activity JSONL, `MEMORY.md`, export และ MCP recall
3. ทุกแห่งต้องเห็น `[REDACTED_SECRET]` และไม่พบ raw secret

### Context-efficient logs

1. รัน fixture ที่สร้าง log หลายหมื่นบรรทัด มี error กลาง log และ summary ท้าย log
2. smart result ต้องมี head, error, tail, omitted counts และอยู่ใต้ size cap
3. raw background output ยังอ่านต่อด้วย cursor ได้

### Screen/system

1. อ่าน/เขียน clipboard แล้วตรวจ round trip
2. แสดง Windows toast
3. capture primary display และหน้าต่างที่เลือก
4. MCP client ต้องได้รับ image content ที่ decode ได้
5. list/focus หน้าต่าง และรายงานกรณี OS ปฏิเสธอย่างถูกต้อง

### Browser

1. เปิด dedicated Edge/Chrome debug profile ไป fixture localhost
2. screenshot + bounded DOM/query/inspect/computed-style ทำงาน และ base64 ไม่ซ้ำใน structured result
3. read-only evaluate คืน bounded JSON; storage/credential APIs และ side-effect expression ต้องถูกปฏิเสธ
4. request trace จับ fresh reload ได้โดยไม่คืน headers/bodies/cookies/credentials
5. performance คืน selected metrics + navigation/paint timing
6. console error/network failure/reload ยังคงทำงาน
7. target ภายนอกและ ChatGPT ต้องถูกปฏิเสธ
8. ไม่มี cookie/token/session data ถูกอ่านหรือบันทึก

---

## 14. สิ่งที่ AI/DEV ไม่ควรทำ

- อย่าทำทุก phase ใน PR/รอบเดียว
- อย่าเพิ่ม vector database ก่อน memory JSON MVP ผ่าน acceptance
- อย่าใช้ OpenAI API เพื่อ compact memory หรือสร้าง embeddings โดยไม่เปลี่ยน product decision อย่างเป็นทางการ
- อย่าเก็บ checkpoint ตาม chat ID เพราะ Qnector ไม่ควรผูกกับ undocumented ChatGPT session internals
- อย่า watch ทุกไฟล์แล้วสร้าง semantic summary ปลอม ๆ
- อย่าแก้ `.gitignore` ของ workspace อัตโนมัติ
- อย่าเก็บ clipboard/screenshot/console content เต็มใน activity log
- อย่าใช้ Electron API จาก renderer โดยตรง
- อย่าทำ platform feature เฉพาะ Electron จน headless server import/start ไม่ได้
- อย่าตั้ง tool ที่เขียน/ลบ/execute เป็น read-only เพื่อเลี่ยง confirmation
- อย่าใช้ Browser DevTools กับ profile หลักหรือหน้า ChatGPT
- อย่าซ่อน raw mouse/keyboard automation ไว้ใต้คำว่า window focus; semantic Windows UI Automation ต้องอยู่ใน `computer` tool แยกและใช้ UIA patterns ตาม `../devq.md`

---

## 15. Definition of done สำหรับ roadmap นี้

งาน roadmap ถือว่าเสร็จเป็นลำดับ ไม่จำเป็นต้องรอ Semantic Search ทั้งหมด:

### Release 1 — Persistent Brain

- memory core/tool/summary/resources/UI ผ่าน tests
- restart/session ใหม่ recall ได้จริง
- sanitizer ครอบทุก persistence surface
- docs และ source of truth สอดคล้องกับ 6 tools หลัง Memory Phase และ 7 tools
  หลัง Browser Phase

### Release 2 — Windows Productivity

- smart logs, activity export, clipboard, toast, global shortcut
- headless และ Electron runtime ใช้ capability abstraction เดียวกัน

### Release 3 — Visual Inspection

- screenshot และ window list/focus ทำงานบน Windows
- semantic Windows UI Automation สำหรับ local desktop apps อยู่ใน `computer` tool แยก โดยไม่มี raw coordinate mouse/general-purpose synthetic keyboard control

### Release 4 — Local Web Diagnostics

- dedicated CDP profile และ localhost-only browser tool
- ไม่มี ChatGPT automation/session access

Semantic search เป็น optional future release หลัง spike ผ่านเกณฑ์ performance/packaging เท่านั้น

---

## 16. คำสั่งส่งต่อให้ AI ตัวพัฒนา

```text
Implement Qnector improvements according to update.md, using ../devq.md as the
current source of truth. First reconcile the explicit scope/tool-count changes
described in update.md with devq.md; do not silently violate it.

Work one phase at a time, beginning with A0 and A1. Preserve headless MCP usage,
full local-access design, honest MCP annotations, and the prohibition on model
API dependency and ChatGPT browser/session automation.

Do not claim AI summarization inside Qnector. Memory compaction and MEMORY.md
must be deterministic unless the calling AI supplies the summary. Run lint,
typecheck, tests, smoke:mcp, and relevant Windows packaging/manual checks at each
phase. Report exact files changed, validation results, and external/manual items.
```

---

## 17. Implementation status (29 August 2026)

The roadmap implementation in this snapshot is complete through the local MVP
phases plus the 29 August 2026 semantic Windows UI Automation expansion. The
repository now includes eight grouped MCP tools, persistent workspace memory,
sanitized mirror/export paths, MCP resources, injected platform capabilities,
smart process output, activity export, global shortcut registration, screenshot
attachments, Windows window inspection/focus, the semantic `computer` UIA tool,
and a localhost-only CDP browser bridge. The UIA MVP supports windows, inspect,
find, invoke, set_value, focus, select, and bounded wait without raw coordinate
mouse control or general-purpose synthetic keyboard input. The browser bridge now
supports MCP screenshot attachments, bounded `dom_snapshot`, CSS `query`, node
`inspect`, selected `computed_style`, read-only bounded `evaluate`, header/body-free
`requests` summaries, and selected `performance` metrics/navigation timing while
retaining loopback-only target filtering and no cookie/storage/session access.
`evaluate` blocks direct cookie/credential/storage APIs and enables CDP
side-effect detection. The desktop renderer
has a Memory drawer with checkpoint/fact editing, compact/export/wipe actions,
and the optional `.qnector/MEMORY.md` toggle.

Validation completed in this snapshot:

- `npx pnpm@10.15.0 typecheck`
- `npx pnpm@10.15.0 test` (29 tests after Browser Phase 4C)
- `npx pnpm@10.15.0 lint`
- `npx pnpm@10.15.0 format:check`
- `npx pnpm@10.15.0 smoke:mcp`
- `npx pnpm@10.15.0 build`
- Electron Builder Windows package PASS at `apps/desktop/release/retry-20260829-174330/`
- packaged `app.asar` verification PASS for Code Intelligence, File Search, UIA, Browser screenshot/DOM, and Browser Phase 4C actions
- real Windows WPF UIA acceptance and real Chrome localhost Browser 4A/4B/4C acceptance PASS

When an already-running packaged Qnector process locks the old release artifact,
the `package:windows` script now writes a timestamped retry directory under
`apps/desktop/release/` instead of failing. Semantic / vector search, real
ChatGPT Plus account verification, and Windows manual capture/focus/toast
acceptance remain follow-up checks; they are intentionally not simulated by the
local automated tests.

## 18. Screenshot troubleshooting

If ChatGPT searches image files under the workspace instead of returning a
screenshot, inspect the connected MCP server's `tools/list`. The updated server
must advertise eight grouped tools and the `system` action schema must contain
`screen_capture`. A five-tool response with `INVALID_ACTION: Unknown system
action 'screen_capture'` means an older Qnector binary is still running.

Close the old Qnector instance from its tray menu, install or launch the newest
Windows artifact under `apps/desktop/release/retry-*/`, then reconnect the MCP
server (and refresh the ChatGPT conversation so it requests `tools/list` again).
For a direct check, call:

```json
{
  "name": "system",
  "arguments": {
    "action": "screen_capture",
    "source": "primary",
    "format": "png"
  }
}
```

The Desktop runtime should report `provider: "electron"` and
`screenCapture: true` from `system.info`. The headless `dev:mcp` runtime keeps
screen capture unavailable by design; use the Electron Desktop runtime for
actual display/window screenshots.

---

## 19. P1–P10 expansion status — 29 August 2026

The owner subsequently requested all previously optional high-value upgrades. This section supersedes older statements in this file that call managed browser launch, generic LSP, Everything indexed-provider validation, or semantic search merely future work.

Implemented while preserving the 8 grouped tools:

- P1: executable build identity plus `system.build_info`, `doctor`, `everything_status`.
- P2: process waits (`wait_for_port/output/exit`) and workspace filesystem watch/wait primitives.
- P3: managed Chrome/Edge dedicated temporary debug-profile launcher/runtime; localhost-only rule preserved.
- P4: modular MCP TypeScript SDK v2. `/mcp` uses `createMcpHandler` and supports modern protocol `2026-07-28` plus legacy 2025-era stateless compatibility on one endpoint.
- P5: TypeScript `workspace_symbols` across the project graph.
- P6: bundled self-contained C# `qnector-uia.exe`, preferred over the existing PowerShell UIA fallback, plus Toggle/ExpandCollapse/ScrollItem/RangeValue semantic actions. Real acceptance fixed non-finite native bounds before JSON serialization.
- P7: bundled Voidtools `es.exe` CLI client and real indexed Everything search on this PC; bounded fallback remains available.
- P8: Qnector durable `task_start/get/list/cancel` process facade plus event waits. This is not the deprecated legacy MCP Tasks wire protocol.
- P9: generic stdio LSP adapter layer for Pyright/BasedPyright, rust-analyzer, gopls, and clangd when installed. Real Pyright document-symbol acceptance passed on Windows, including npm `.cmd` shim handling without `shell:true`.
- P10: deterministic local `local-hashed-vector-v1` semantic search. It uses bounded text chunks and hashed lexical/trigram features, calls no model/embedding API, and requires no vector database.

Permanent acceptance harness:

```powershell
npx pnpm@10.15.0 accept:p1-p10
```

The harness performs real local checks for build/doctor, process/filesystem events, managed Chrome, TypeScript workspace symbols, C# UIA helper, Everything indexed search, durable tasks, real external Pyright LSP, and semantic search. MCP integration tests separately pin the v2 client to `2026-07-28` and verify legacy stateless compatibility.

Automated test total after this expansion is **33 tests** before final release packaging.

### Final P1–P10 Windows release

Final package directory:

`C:\Users\QUEEN\qnector\apps\desktop\release\retry-20260829-192710`

Portable:

`C:\Users\QUEEN\qnector\apps\desktop\release\retry-20260829-192710\Qnector-0.1.0-win-x64-portable.exe`

- size: `166,689,096 bytes`
- SHA-256: `951907513D9A2CE47B9986BBAA6DC2284B956495B45A972001AAEBE906D96D8B`

Setup SHA-256: `53E4F783673EF31FEAF3EF8AED03C62250FF544BB8695A0861B2F9CB3AE0F6D3`.

Final gates: typecheck PASS; 33/33 tests PASS; ESLint PASS; Prettier PASS; production build PASS; MCP smoke PASS with 8 grouped tools; real `accept:p1-p10` PASS; packaged app.asar inspection PASS; modular MCP server/node v2.0.0 present with no legacy SDK directory; bundled self-contained `qnector-uia.exe` and Everything `es.exe` present.

---

## 20. Automatic First-Use Memory Bootstrap — 29 August 2026

Qnector now loads bounded workspace continuity memory automatically during the MCP session-opening handshake instead of requiring the AI to remember to call `memory.recall` first. Legacy/compatibility clients receive the bootstrap in the `initialize` result's server `instructions`; modern MCP `2026-07-28` clients receive the same bootstrap through `server/discover` and expose it via `client.getInstructions()`.

The bootstrap is generated by `packages/mcp-server/src/session-bootstrap.ts`, capped at 8,000 UTF-8 bytes, and includes the resolved active workspace, latest checkpoint, current task, completed/pending steps, critical context, bounded core facts and recent Qnector changes. Normal tool responses do not repeat the block. Memory-read failures produce non-fatal bootstrap guidance and do not disable normal Qnector tools.

MCP does not expose a ChatGPT conversation ID to Qnector. Therefore the observable boundary is the MCP connection-opening handshake; if a client deliberately reuses one MCP connection across multiple chats, Qnector cannot distinguish those chats as separate sessions.

Validation after this change: typecheck PASS; **41/41 tests PASS**; ESLint PASS; Prettier PASS; production build PASS; MCP smoke PASS with 8 grouped tools; `accept:p1-p10` PASS. Integration tests verify both legacy `initialize` instructions and modern `2026-07-28` `server/discover`/`client.getInstructions()`. Windows package `retry-20260829-214619` PASS; packaged `app.asar` contains `dist/session-bootstrap.js` and the server handshake integration, MCP server/node v2.0.0 remain present, and the legacy SDK directory remains absent.

---

## 21. Windows Taskbar application identity fix — 29 August 2026

The packaged executable already contained the correct Qnector icon, but the running Electron renderer identified itself to Windows as `electron.app.Qnector` instead of the product AppUserModelID declared by electron-builder (`app.qnector.desktop`). This could make Windows group the window under Electron identity and show the wrong taskbar icon even though `icon.ico`, `icon.png`, the portable launcher, and the extracted `Qnector.exe` all contained the Qnector artwork.

`apps/desktop/src/main/main.ts` now calls `app.setAppUserModelId("app.qnector.desktop")` before acquiring the single-instance lock and applies matching `BrowserWindow.setAppDetails()` with `appIconPath: process.execPath`. This aligns the runtime window identity with `electron-builder.yml` and explicitly points the Windows taskbar/relaunch metadata at the executable's embedded Qnector icon.

Validation: typecheck PASS; **41/41 tests PASS**; ESLint PASS; Prettier PASS; production build PASS. Windows package `retry-20260829-215735` PASS. Packaged `app.asar` contains `app.qnector.desktop`, `setAppUserModelId`, `setAppDetails`, and `appIconPath`; both portable and unpacked `Qnector.exe` expose embedded 32x32 associated icons. Portable SHA-256: `E51FEFB2B3CF46D98C2CDB7A94D26415C85B41DE6929F7C15380DD1897327F33`.

---

## 22. Desktop UI dynamic-content overflow hardening — 29 August 2026

The Memory drawer could allow long checkpoint/context/fact strings (especially paths, hashes and unbroken tokens) to exceed their visual card width because several nested flex items retained intrinsic minimum widths and `memory-fact-chip` had no bounded wrapping policy. The same audit identified narrow-window risk in Workspace paths/actions, Settings labels/native select sizing, endpoint/activity flex rows and the bottom dock.

`apps/desktop/src/renderer/styles.css` now applies narrow-window layout guards: `min-width: 0` / `max-width: 100%` on shrinkable flex/card containers, `overflow-wrap: anywhere` plus `word-break: break-word` for dynamic text, full-width bounded memory fact rows, one drawer scroll owner instead of nested Memory scrolling, explicit select flex sizing/ellipsis, and overflow containment for drawer/activity/navigation surfaces. Memory facts are stacked vertically so long persistent facts remain readable instead of stretching inline chips.

A real Chromium localhost fixture using the production stylesheet exercised Memory goal/context/checklist/facts, Workspace path/actions and Settings at the inner width corresponding to the minimum 380px desktop window, with intentionally long unbroken data. Result after the fix: **0 visible horizontal overflows**. A CSS regression suite (`apps/desktop/src/renderer/styles.test.ts`) adds 3 guards; full automated total is now **44/44 tests PASS**. Typecheck, ESLint, Prettier, production build, MCP smoke and `accept:p1-p10` all pass. Windows package `retry-20260829-224101` PASS; packaged renderer CSS contains the hardening rules and the prior Taskbar identity fix remains present. Portable SHA-256: `C63D4024B4E5BA432965EF8B8DB9B70EA262A591EE12FFB0CE631E4F12F9FD51`.
