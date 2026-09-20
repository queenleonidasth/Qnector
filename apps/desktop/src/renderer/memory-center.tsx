import React, { useMemo, useState } from "react";
import type { MemoryV2Snapshot, MemoryFact, MemoryTask } from "@qnector/shared";
import {
  filterMemories,
  pendingTasks,
  presentMemories,
} from "./memory-center-model.js";
import "./memory-center.css";

type LegacyFact = Omit<
  Pick<MemoryFact, "id" | "key" | "value" | "category" | "updatedAt">,
  "category"
> & { category: string };
type V2MemoryRecord = MemoryFact & {
  scope: "workspace" | "task";
  taskId: string | null;
  taskTitle: string | null;
};
interface InventoryPage<T> {
  items: T[];
  total: number;
  nextCursor: number | null;
  workspaceId: string;
}
export interface MemoryCenterData {
  workspaceId?: string;
  available: boolean;
  updatedAt: string;
  warning?: string;
  state: {
    active: {
      currentTask: string;
      pendingSteps: string[];
      completedSteps: string[];
      criticalContext: string;
    } | null;
    facts: LegacyFact[];
  };
  v2?: MemoryV2Snapshot;
  counts: { facts: number; checkpoints: number; recentChanges: number };
}
const categories = [
  { id: "rule", name: "กฎของโปรเจกต์" },
  { id: "decision", name: "การตัดสินใจ" },
  { id: "fact", name: "ข้อมูลสำคัญ" },
  { id: "note", name: "บันทึกอื่น" },
  { id: "unknown", name: "รายการที่ต้องตรวจสอบประเภท" },
] as const;
function taskStatus(status: string): string {
  return (
    (
      {
        active: "กำลังทำ",
        blocked: "ติดขัด",
        idle: "พักไว้",
        completed: "เสร็จแล้ว",
      } as Record<string, string>
    )[status] ?? "ไม่ทราบสถานะ"
  );
}
export function MemoryCenter({
  memory,
  workspace,
  busy,
  onOpen,
  onExport,
  onClear,
}: {
  memory?: MemoryCenterData;
  workspace?: string;
  busy: boolean;
  onOpen: () => void;
  onExport: () => void;
  onClear: () => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [visibleMemories, setVisibleMemories] = useState(12);
  const [showTasks, setShowTasks] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);
  const [v2Page, setV2Page] = useState<InventoryPage<V2MemoryRecord> | null>(
    null,
  );
  const [legacyPage, setLegacyPage] =
    useState<InventoryPage<LegacyFact> | null>(null);
  const [taskPage, setTaskPage] = useState<InventoryPage<MemoryTask> | null>(
    null,
  );
  const [loadingPage, setLoadingPage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const v2Records = useMemo(() => {
    const byId = new Map<string, MemoryFact | V2MemoryRecord>();
    for (const item of v2Page?.items ?? []) byId.set(item.id, item);
    for (const item of memory?.v2?.memories ?? [])
      if (!byId.has(item.id)) byId.set(item.id, item);
    return Array.from(byId.values());
  }, [memory, v2Page]);
  const legacyRecords = useMemo(() => {
    const byId = new Map<string, LegacyFact>();
    for (const item of memory?.state.facts ?? []) byId.set(item.id, item);
    for (const item of legacyPage?.items ?? []) byId.set(item.id, item);
    return Array.from(byId.values());
  }, [memory, legacyPage]);
  const records = useMemo(
    () => presentMemories(v2Records, legacyRecords),
    [v2Records, legacyRecords],
  );
  const filtered = filterMemories(records, query);
  const tasks = useMemo(() => {
    const byId = new Map<string, MemoryTask>();
    for (const item of taskPage?.items ?? []) byId.set(item.id, item);
    for (const item of memory?.v2?.tasks ?? [])
      if (!byId.has(item.id)) byId.set(item.id, item);
    return Array.from(byId.values());
  }, [memory, taskPage]);
  const openTasks = pendingTasks(tasks);
  const requestPage = async <T,>(
    input: Record<string, unknown>,
  ): Promise<InventoryPage<T>> => {
    const result = await window.qnector.callMemory(input);
    if (!result.ok) throw new Error(result.error?.message ?? result.summary);
    const wrapped = result.data as { data?: unknown } | undefined;
    const raw = (wrapped?.data ?? wrapped) as (InventoryPage<T> & { facts?: T[] }) | undefined;
    const items = Array.isArray(raw?.items) ? raw.items : raw?.facts;
    if (!raw || !Array.isArray(items) || !Number.isFinite(raw.total))
      throw new Error("Invalid memory inventory response");
    return { ...raw, items };
  };
  const loadPage = async (
    kind: "memories" | "tasks" | "legacy",
  ): Promise<void> => {
    if (loadingPage || !memory) return;
    setLoadingPage(kind);
    setPageError(null);
    try {
      if (kind === "legacy") {
        const page = await requestPage<LegacyFact>({
          action: "list",
          cursor: legacyPage?.nextCursor ?? 0,
          limit: 100,
        });
        if (memory.workspaceId && page.workspaceId !== memory.workspaceId)
          return;
        setLegacyPage((current) => ({
          ...page,
          items: [...(current?.items ?? []), ...page.items],
        }));
      } else if (kind === "memories") {
        const page = await requestPage<V2MemoryRecord>({
          action: "v2_inventory",
          inventoryType: "memories",
          cursor: v2Page?.nextCursor ?? 0,
          limit: 100,
        });
        if (page.workspaceId !== memory.v2?.workspaceId) return;
        setV2Page((current) => ({
          ...page,
          items: [...(current?.items ?? []), ...page.items],
        }));
      } else {
        const page = await requestPage<MemoryTask>({
          action: "v2_inventory",
          inventoryType: "tasks",
          cursor: taskPage?.nextCursor ?? 0,
          limit: 100,
        });
        if (page.workspaceId !== memory.v2?.workspaceId) return;
        setTaskPage((current) => ({
          ...page,
          items: [...(current?.items ?? []), ...page.items],
        }));
      }
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingPage(null);
    }
  };
  const workspaceName =
    workspace
      ?.replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  return (
    <div className="memory-center">
      <header className="memory-center-intro">
        <strong>ความจำของโปรเจกต์นี้</strong>
        <span>
          ความจำใน QNECTOR เฉพาะ Workspace ไม่ใช่ความจำทั้งหมดของ ChatGPT
        </span>
        <code title={workspace}>{workspace || "ยังไม่ได้เลือก Workspace"}</code>
        <small>
          อัปเดตข้อมูล:{" "}
          {memory?.updatedAt
            ? new Date(memory.updatedAt).toLocaleString()
            : "ยังไม่ทราบ"}
        </small>
      </header>
      {memory?.warning && (
        <p role="alert" className="memory-center-warning">
          {memory.warning}
        </p>
      )}
      {!memory ? (
        <p role="status">กำลังโหลดความจำ…</p>
      ) : (
        <>
          <div className="memory-center-counts" aria-label="ภาพรวมความจำ">
            <div>
              <strong>
                {v2Records.length} + {legacyRecords.length}
              </strong>
              <span>v2 + เดิม (อาจซ้ำ)</span>
            </div>
            <div>
              <strong>{openTasks.length}</strong>
              <span>งานค้างที่แสดง</span>
            </div>
            <div>
              <strong>{memory.v2?.conflicts.length ?? 0}</strong>
              <span>ความขัดแย้งที่พบ</span>
            </div>
          </div>
          <section aria-label="ความจำที่บันทึกไว้">
            <h3>สิ่งที่ QNECTOR จำไว้</h3>
            <label className="memory-center-search">
              ค้นหาในรายการที่โหลดมา
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ค้นหากฎ ข้อมูล หรือการตัดสินใจ"
              />
            </label>
            {memory.counts.facts > legacyRecords.length && (
              <p className="memory-center-note" role="status">
                ข้อมูลรุ่นเดิมแสดง {legacyRecords.length} จาก{" "}
                {memory.counts.facts} รายการ
              </p>
            )}
            {memory.counts.facts > legacyRecords.length &&
              legacyPage?.nextCursor !== null && (
                <button
                  type="button"
                  disabled={loadingPage !== null}
                  onClick={() => void loadPage("legacy")}
                >
                  {loadingPage === "legacy"
                    ? "กำลังโหลด…"
                    : "โหลดความจำรุ่นเดิมเพิ่มจากเครื่อง"}
                </button>
              )}
            {memory.v2 &&
              (v2Page?.total ?? memory.v2.counts.memories) >
                v2Records.length && (
                <p className="memory-center-note" role="status">
                  Memory v2 แสดง {v2Records.length} จาก{" "}
                  {v2Page?.total ?? memory.v2.counts.memories}{" "}
                  รายการรวมทั้งความจำที่ผูกกับงาน
                </p>
              )}
            {memory.v2 &&
              (v2Page === null
                ? memory.v2.counts.memories > memory.v2.memories.length
                : v2Page.nextCursor !== null) && (
                <button
                  type="button"
                  disabled={loadingPage !== null}
                  onClick={() => void loadPage("memories")}
                >
                  {loadingPage === "memories"
                    ? "กำลังโหลด…"
                    : "โหลดความจำ Memory v2 เพิ่มจากเครื่อง (รวมความจำรายงาน)"}
                </button>
              )}
            {pageError && (
              <p role="alert" className="memory-center-warning">
                โหลดข้อมูลไม่สำเร็จ: {pageError}
              </p>
            )}
            {records.length === 0 ? (
              <p className="memory-center-note">
                ยังไม่มีรายการความจำที่โหลดมาใน Workspace นี้
              </p>
            ) : (
              categories.map((category) => {
                const entries = filtered.filter((item) =>
                  category.id === "unknown"
                    ? !categories.some(
                        (known) =>
                          known.id !== "unknown" && known.id === item.category,
                      )
                    : item.category === category.id,
                );
                return (
                  <details key={category.id} className="memory-center-section">
                    <summary>
                      {category.name} <span>{entries.length} รายการ</span>
                    </summary>
                    {entries.length === 0 ? (
                      <p className="memory-center-note">
                        ไม่มีรายการที่ตรงกับการค้นหา
                      </p>
                    ) : (
                      entries.slice(0, visibleMemories).map((item) => (
                        <details
                          className="memory-center-record"
                          key={`${item.source}-${item.id}`}
                        >
                          <summary>
                            <strong>{item.key}</strong>
                            <span>
                              {item.source}
                              {item.scope === "task"
                                ? " · เฉพาะงาน"
                                : item.source === "Memory v2"
                                  ? " · Workspace"
                                  : ""}
                            </span>
                          </summary>
                          <p>{item.value}</p>
                          {item.scope === "task" && (
                            <p className="memory-center-note">
                              งาน:{" "}
                              {item.taskTitle ||
                                item.taskId ||
                                "ไม่ทราบชื่องาน"}
                            </p>
                          )}
                          <small>
                            บันทึก:{" "}
                            {item.updatedAt
                              ? new Date(item.updatedAt).toLocaleString()
                              : "ไม่ทราบ"}
                          </small>
                        </details>
                      ))
                    )}
                    {entries.length > visibleMemories && (
                      <p className="memory-center-note">
                        แสดง {Math.min(visibleMemories, entries.length)} จาก{" "}
                        {entries.length} รายการ — กดโหลดเพิ่มด้านล่าง
                      </p>
                    )}
                  </details>
                );
              })
            )}
            {query && filtered.length === 0 && (
              <p role="status">ไม่พบรายการที่ตรงกับคำค้น</p>
            )}
            <button
              type="button"
              className="memory-center-button"
              onClick={() =>
                setVisibleMemories((count) =>
                  count >= filtered.length
                    ? 12
                    : Math.min(filtered.length, count + 12),
                )
              }
            >
              {visibleMemories >= filtered.length
                ? "แสดงแบบย่อ"
                : "แสดงเพิ่มอีก 12 รายการ"}
            </button>
            <p className="memory-center-note">
              รายการจากระบบเดิมและ Memory v2 แสดงแยกตามแหล่งข้อมูล
              เนื่องจากยังไม่มีรหัสจับคู่สำหรับการย้ายข้อมูล จึงอาจมีรายการซ้ำ
            </p>
          </section>
          <section aria-label="งานที่ทำต่อได้">
            <h3>งานที่ทำต่อได้</h3>
            {!memory.v2 && (
              <p className="memory-center-note">
                ระบบงาน Memory v2 ยังไม่พร้อมใช้งาน
              </p>
            )}
            {memory.v2 && openTasks.length === 0 && (
              <p className="memory-center-note">
                ไม่พบงานที่กำลังทำหรือติดขัดในรายการที่โหลดมา
              </p>
            )}
            {(showTasks ? tasks : openTasks.slice(0, 2)).map((task) => (
              <details className="memory-center-task" key={task.id}>
                <summary>
                  <span className="memory-center-badge">
                    {taskStatus(task.status)}
                  </span>
                  <strong>{task.title}</strong>
                </summary>
                <p>{task.currentTask || "ยังไม่มีรายละเอียดงาน"}</p>
                <strong>ขั้นตอนถัดไป</strong>
                {task.pendingSteps.length ? (
                  <ul>
                    {task.pendingSteps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ul>
                ) : (
                  <p>ยังไม่มีขั้นตอนถัดไปที่บันทึกไว้</p>
                )}
                {task.criticalContext && <p>บริบท: {task.criticalContext}</p>}
                <details>
                  <summary>รายละเอียดทางเทคนิคและขั้นตอนที่เสร็จ</summary>
                  <code>{task.id}</code>
                  <ul>
                    {task.completedSteps.map((step, index) => (
                      <li key={index}>
                        {step} —{" "}
                        {/^(?:(?:files|git|manual): |(?:files|git|process|browser|computer)\.[a-z_]+: )/i.test(
                          step,
                        )
                          ? "ผลเก่าที่ยังไม่ยืนยัน"
                          : "บันทึกว่าเสร็จแล้ว"}
                      </li>
                    ))}
                  </ul>
                </details>
              </details>
            ))}
            {(tasks.length > 2 || memory.v2?.counts.tasks !== tasks.length) && (
              <button
                type="button"
                className="memory-center-button"
                onClick={() => setShowTasks((value) => !value)}
              >
                {showTasks ? "ย่อรายการงาน" : "ดูงานทั้งหมดที่โหลดมา"}
              </button>
            )}
            {memory.v2 &&
              (taskPage === null
                ? memory.v2.tasks.length >= 100
                : taskPage.nextCursor !== null) && (
                <button
                  type="button"
                  disabled={loadingPage !== null}
                  onClick={() => void loadPage("tasks")}
                >
                  {loadingPage === "tasks"
                    ? "กำลังโหลด…"
                    : "โหลดงานเพิ่มเติมจากเครื่อง"}
                </button>
              )}
            {taskPage && (
              <p className="memory-center-note">
                โหลดงานแล้ว {tasks.length} จากทั้งหมด {taskPage.total} งาน
              </p>
            )}
            {memory.state.active?.currentTask && (
              <details
                className="memory-center-section"
                open={showLegacy}
                onToggle={(event) => setShowLegacy(event.currentTarget.open)}
              >
                <summary>เป้าหมายจาก Memory รุ่นเดิม</summary>
                <p>{memory.state.active.currentTask}</p>
                <p>{memory.state.active.criticalContext}</p>
                <ul>
                  {memory.state.active.pendingSteps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <details className="memory-center-section">
            <summary>รายละเอียดสำหรับตรวจสอบ</summary>
            <p>
              Checkpoint: {memory.counts.checkpoints} · Event ทั้งหมด:{" "}
              {memory.v2?.counts.events ?? "ไม่ทราบ"}
            </p>
            {memory.v2 &&
              (taskPage?.total ?? memory.v2.tasks.length) >
                memory.v2.tasks.length && (
                <p className="memory-center-note">
                  การตรวจจับไฟล์ขัดแย้งจาก Snapshot ครอบคลุมเฉพาะ{" "}
                  {memory.v2.tasks.length} งานแรก ไม่ใช่ทุกงานในฐานข้อมูล
                </p>
              )}
            {memory.v2?.conflicts.map((conflict) => (
              <p role="alert" key={conflict.id}>
                ไฟล์ขัดแย้ง: {conflict.taskTitles.join(" / ")} — {conflict.path}
              </p>
            ))}
            {memory.v2?.events.map((event) => (
              <p key={event.id}>
                {event.timestamp} · {event.source}.{event.action}:{" "}
                {event.summary}
              </p>
            ))}
          </details>
        </>
      )}
      <footer className="memory-center-actions">
        <button type="button" disabled={busy} onClick={onOpen}>
          ดู MEMORY.md
        </button>
        <button type="button" disabled={busy} onClick={onExport}>
          Export Memory
        </button>
      </footer>
      <details
        className="memory-center-danger"
        open={dangerOpen}
        onToggle={(event) => setDangerOpen(event.currentTarget.open)}
      >
        <summary>จัดการความจำ (ลบข้อมูล)</summary>
        <p>
          ลบความจำของ Workspace {workspace} ทั้งระบบเดิมและ Memory v2
          การลบไม่สามารถย้อนกลับได้
        </p>
        <label>
          พิมพ์ชื่อ Workspace เพื่อยืนยัน
          <input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            aria-label="พิมพ์ชื่อ Workspace เพื่อยืนยันการลบ"
          />
        </label>
        <button
          type="button"
          className="memory-center-delete"
          disabled={busy || !workspaceName || confirmName !== workspaceName}
          onClick={() => {
            onClear();
            setV2Page(null);
            setLegacyPage(null);
            setTaskPage(null);
            setVisibleMemories(12);
            setConfirmName("");
          }}
        >
          ลบความจำทั้งหมดของ Workspace นี้
        </button>
      </details>
    </div>
  );
}
