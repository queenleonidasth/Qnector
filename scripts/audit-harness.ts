import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentSkillService,
  FileWatchService,
  ProcessManager,
  WorkflowManager,
} from "../packages/core/src/index.js";

// Diagnostic observations, not a passing acceptance suite. All mutations use
// an isolated mkdtemp workspace; the script reports gaps without touching user data.
const root = await mkdtemp(path.join(os.tmpdir(), "qnector-harness-audit-"));
const processes = new ProcessManager("direct");
const watch = new FileWatchService();
const workflows = new WorkflowManager(processes, watch);
try {
  const script = path.join(root, "delayed-write.mjs");
  await writeFile(
    script,
    "import { writeFileSync } from 'node:fs'; writeFileSync('ready.txt', 'ready'); setTimeout(() => writeFileSync('after-cancel.txt', 'still ran'), 600);\n",
  );
  await workflows.save(root, {
    name: "cancellation-probe",
    steps: [
      {
        type: "command",
        command: `\"${process.execPath}\" \"${script}\"`,
        shell: "direct",
        timeoutMs: 5000,
      },
    ],
  });
  const run = await workflows.start(root, "cancellation-probe");
  await watch.waitForFile({ root, pattern: "ready.txt", timeoutMs: 5000 });
  const canceled = await workflows.cancel(root, run.runId);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const wroteAfterCancel = await access(
    path.join(root, "after-cancel.txt"),
  ).then(
    () => true,
    () => false,
  );
  const stored = JSON.parse(
    await readFile(
      path.join(root, ".qnector", "workflow-runs", `${run.runId}.json`),
      "utf8",
    ),
  );
  const skills = new AgentSkillService({
    roots: [
      {
        path: path.resolve(import.meta.dirname, "../skills"),
        source: "bundled",
      },
    ],
    workspaceRoot: () => root,
  });
  const thai = await skills.match("แก้ไขเอกสารและตารางหลายไฟล์แล้วตรวจผล", 3);
  const english = await skills.match(
    "edit documents spreadsheets and validate outputs",
    3,
  );
  console.log(
    JSON.stringify(
      {
        diagnosticOnly: true,
        cancellation: {
          reportedState: canceled.state,
          wroteAfterCancel,
          persistedState: stored.state,
        },
        skillRouting: {
          thai: thai.map((skill) => skill.name),
          english: english.map((skill) => skill.name),
        },
      },
      null,
      2,
    ),
  );
} finally {
  watch.stopAll();
  await processes.stopAll();
  await rm(root, { recursive: true, force: true });
}
