import React, { useMemo, useState } from "react";
import type { MemoryV2Snapshot, MemoryFact } from "@qnector/shared";
import "./memory-center.css";

type LegacyFact = Omit<
  Pick<MemoryFact, "id" | "key" | "value" | "category" | "updatedAt">,
  "category"
> & { category: string };
export interface MemoryCenterData {
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
  const [showAll, setShowAll] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);
  const records = useMemo(() => {
    if (!memory) return [];
    // Different stores do not expose a migration identity. Do not silently discard either source.
    return [
      ...(memory.v2?.memories ?? []).map((item) => ({
        ...item,
        source: "Memory v2",
      })),
      ...memory.state.facts.map((item) => ({ ...item, source: "Legacy" })),
    ];
  }, [memory]);
  const filtered = records.filter((item) =>
    `${item.key} ${item.value} ${item.category}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const tasks = memory?.v2?.tasks ?? [];
  const openTasks = tasks.filter(
    (task) => task.status === "active" || task.status === "blocked",
  );
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
              <strong>{records.length}</strong>
              <span>รายการที่โหลดมา</span>
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
            {(memory.v2?.counts.memories ?? 0) >
              (memory.v2?.memories.length ?? 0) && (
              <p className="memory-center-note">
                Memory v2 แสดง {memory.v2?.memories.length} จาก{" "}
                {memory.v2?.counts.memories} รายการ —
                ข้อมูลส่วนที่เหลือยังไม่โหลด
              </p>
            )}
            {records.length === 0 ? (
              <p className="memory-center-note">
                ยังไม่มีรายการความจำที่โหลดมาใน Workspace นี้
              </p>
            ) : (
              categories.map((category) => {
                const entries = filtered.filter(
                  (item) => item.category === category.id,
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
                      (showAll ? entries : entries.slice(0, 3)).map((item) => (
                        <details
                          className="memory-center-record"
                          key={`${item.source}-${item.id}`}
                        >
                          <summary>
                            <strong>{item.key}</strong>
                            <span>{item.source}</span>
                          </summary>
                          <p>{item.value}</p>
                          <small>
                            บันทึก:{" "}
                            {item.updatedAt
                              ? new Date(item.updatedAt).toLocaleString()
                              : "ไม่ทราบ"}
                          </small>
                        </details>
                      ))
                    )}
                    {!showAll && entries.length > 3 && (
                      <p className="memory-center-note">
                        แสดง 3 จาก {entries.length} รายการ — กดดูทั้งหมดด้านล่าง
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
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "แสดงแบบย่อ" : "ดูรายการที่โหลดมาทั้งหมด"}
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
            setConfirmName("");
          }}
        >
          ลบความจำทั้งหมดของ Workspace นี้
        </button>
      </details>
    </div>
  );
}
