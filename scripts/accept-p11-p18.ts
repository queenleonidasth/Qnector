import * as fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";
import {
  ActivityLogger,
  defaultConfig,
  shutdownPowerShellWorkers,
} from "../packages/core/src/index.js";
import { QnectorRuntime } from "../packages/mcp-server/src/server.js";
import type { ToolResult } from "../packages/shared/src/types.js";

XLSX.set_fs(fs);

const projectRoot = path.resolve(import.meta.dirname, "..");
const root = await mkdtemp(path.join(os.tmpdir(), "qnector-p11-p18-"));
const checks: Record<string, unknown> = {};

try {
  await createFixtures(root);

  const projectRuntime = new QnectorRuntime({
    config: {
      ...defaultConfig(projectRoot),
      transport: { mode: "local-only" as const },
    },
    logger: new ActivityLogger(path.join(root, "project-activity.jsonl")),
  });

  const processInfo = unwrap<{
    process: { pid: number; name: string; executablePath: string | null };
    ports: unknown[];
  }>(
    await projectRuntime.registry.call("system", projectRuntime.context(), {
      action: "process_info",
      pid: process.pid,
    }),
  );
  assert(
    processInfo.process.pid === process.pid,
    "P12 process_info did not resolve the current Node process",
  );
  checks.p12ProcessInfo = {
    pid: processInfo.process.pid,
    name: processInfo.process.name,
    executablePath: processInfo.process.executablePath,
  };

  const processSearch = unwrap<{
    processes: Array<{ pid: number }>;
    total: number;
  }>(
    await projectRuntime.registry.call("system", projectRuntime.context(), {
      action: "find_process",
      query: processInfo.process.name,
      maxResults: 50,
    }),
  );
  assert(
    processSearch.processes.some((entry) => entry.pid === process.pid),
    "P12 find_process did not find the current process",
  );
  checks.p12FindProcess = processSearch.total;

  const release = unwrap<{
    status: string;
    releaseRoot: string;
    packagedBuildCount: number;
    recommendation: string;
  }>(
    await projectRuntime.registry.call("system", projectRuntime.context(), {
      action: "release_status",
    }),
  );
  assert(
    release.releaseRoot.endsWith(path.join("apps", "desktop", "release")),
    "P17 release_status returned an unexpected release root",
  );
  assert(
    release.packagedBuildCount > 0,
    "P17 release_status found no packaged Qnector builds",
  );
  checks.p17Release = release;

  const snapshot = unwrap<{
    build: { version: string };
    workspace: string;
    nativeQnectorProcesses: unknown[];
    recentActivity: unknown[];
    capabilities: Record<string, boolean>;
  }>(
    await projectRuntime.registry.call("system", projectRuntime.context(), {
      action: "context_snapshot",
    }),
  );
  assert(
    path.resolve(snapshot.workspace) === projectRoot,
    "P11 context_snapshot workspace mismatch",
  );
  assert(
    snapshot.capabilities.workflow &&
      snapshot.capabilities.documentIntelligence &&
      snapshot.capabilities.nativeProcess &&
      snapshot.capabilities.releaseManager,
    "P11 context_snapshot is missing new capability flags",
  );
  checks.p11ContextSnapshot = {
    version: snapshot.build.version,
    nativeQnectorProcesses: snapshot.nativeQnectorProcesses.length,
    recentActivity: snapshot.recentActivity.length,
  };

  const tempRuntime = new QnectorRuntime({
    config: {
      ...defaultConfig(root),
      transport: { mode: "local-only" as const },
    },
    logger: new ActivityLogger(path.join(root, "fixture-activity.jsonl")),
  });

  const jsonInspect = unwrap<{
    kind: string;
    metadata: { topLevelKeys?: string[] };
  }>(
    await tempRuntime.registry.call("files", tempRuntime.context(), {
      action: "inspect",
      path: "sample.json",
    }),
  );
  assert(jsonInspect.kind === "json", "P15 JSON inspect kind mismatch");

  const csvText = unwrap<{ kind: string; text: string }>(
    await tempRuntime.registry.call("files", tempRuntime.context(), {
      action: "extract_text",
      path: "sample.csv",
    }),
  );
  assert(
    csvText.text.includes("Widget"),
    "P15 CSV extract_text lost fixture content",
  );

  const docxText = unwrap<{ kind: string; text: string }>(
    await tempRuntime.registry.call("files", tempRuntime.context(), {
      action: "extract_text",
      path: "sample.docx",
    }),
  );
  assert(
    docxText.kind === "docx" &&
      docxText.text.includes("Qnector DOCX acceptance"),
    "P15 DOCX extraction failed",
  );

  const xlsxText = unwrap<{
    kind: string;
    text: string;
    metadata: { sheets?: string[] };
  }>(
    await tempRuntime.registry.call("files", tempRuntime.context(), {
      action: "extract_text",
      path: "sample.xlsx",
    }),
  );
  assert(
    xlsxText.text.includes("Branch A") &&
      xlsxText.metadata.sheets?.includes("Stock"),
    "P15 XLSX extraction failed",
  );

  const zipText = unwrap<{ kind: string; text: string }>(
    await tempRuntime.registry.call("files", tempRuntime.context(), {
      action: "extract_text",
      path: "sample.zip",
    }),
  );
  assert(zipText.text.includes("inside.txt"), "P15 ZIP listing failed");

  const sqliteQuery = unwrap<{
    rows: Array<Record<string, unknown>>;
    truncated: boolean;
  }>(
    await tempRuntime.registry.call("files", tempRuntime.context(), {
      action: "document_query",
      path: "sample.sqlite",
      sql: "SELECT sku, qty FROM inventory ORDER BY sku",
      maxRows: 20,
    }),
  );
  assert(
    sqliteQuery.rows.length === 2 && sqliteQuery.rows[0]?.sku === "GPU-A",
    "P15 SQLite query failed",
  );

  const pdfText = unwrap<{
    kind: string;
    text: string;
    metadata: { pageCount?: number };
  }>(
    await tempRuntime.registry.call("files", tempRuntime.context(), {
      action: "extract_text",
      path: "sample.pdf",
      page: 1,
    }),
  );
  assert(
    pdfText.kind === "pdf" &&
      pdfText.text.includes("Qnector PDF acceptance") &&
      pdfText.metadata.pageCount === 1,
    "P15 PDF text extraction failed",
  );

  const pdfRenderResult = await tempRuntime.registry.call(
    "files",
    tempRuntime.context(),
    {
      action: "render",
      path: "sample.pdf",
      page: 1,
      maxWidth: 900,
    },
  );
  const pdfRender = unwrap<{
    page: number;
    pageCount: number;
    width?: number;
    height?: number;
  }>(pdfRenderResult);
  assert(
    pdfRenderResult.attachments?.length === 1 &&
      pdfRender.page === 1 &&
      pdfRender.pageCount === 1,
    "P15 PDF render did not return an image attachment",
  );
  checks.p15Documents = {
    json: jsonInspect.kind,
    csv: csvText.kind,
    docx: docxText.kind,
    xlsxSheets: xlsxText.metadata.sheets,
    zip: zipText.kind,
    sqliteRows: sqliteQuery.rows.length,
    pdfChars: pdfText.text.length,
    pdfRender: { width: pdfRender.width, height: pdfRender.height },
  };

  const workflowDefinition = unwrap<{ name: string; steps: unknown[] }>(
    await tempRuntime.registry.call("process", tempRuntime.context(), {
      action: "workflow_save",
      workflowName: "acceptance-flow",
      description: "P14 persistent workflow acceptance",
      steps: [
        {
          type: "command",
          command: "Write-Output 'workflow-ok'",
          shell: "powershell",
          timeoutMs: 30_000,
        },
        { type: "delay", delayMs: 20 },
      ],
    }),
  );
  assert(
    workflowDefinition.steps.length === 2,
    "P14 workflow definition did not persist two steps",
  );

  const startedWorkflow = unwrap<{ runId: string; workflow: string }>(
    await tempRuntime.registry.call("process", tempRuntime.context(), {
      action: "workflow_start",
      workflowName: "acceptance-flow",
    }),
  );
  const completedWorkflow = await waitForWorkflow(
    tempRuntime,
    startedWorkflow.runId,
  );
  assert(
    completedWorkflow.state === "succeeded",
    `P14 workflow ended as ${completedWorkflow.state}: ${completedWorkflow.error ?? ""}`,
  );
  const persistedRun = JSON.parse(
    await readFile(
      path.join(
        root,
        ".qnector",
        "workflow-runs",
        `${startedWorkflow.runId}.json`,
      ),
      "utf8",
    ),
  ) as { state: string };
  assert(
    persistedRun.state === "succeeded",
    "P14 workflow run state was not persisted",
  );
  checks.p14Workflow = {
    workflow: startedWorkflow.workflow,
    runId: startedWorkflow.runId,
    state: completedWorkflow.state,
    steps: completedWorkflow.steps.map((entry) => entry.state),
  };

  await tempRuntime.registry.call("files", tempRuntime.context(), {
    action: "read",
    path: "sample.json",
    limitLines: 20,
  });
  await tempRuntime.registry.call("process", tempRuntime.context(), {
    action: "run",
    command: "Write-Output 'working-set-command'",
    shell: "powershell",
    timeoutMs: 30_000,
  });
  const workingSet = unwrap<{
    lastFilesRead: string[];
    lastCommands: Array<{ command: string }>;
    recentActions: unknown[];
    workflowRuns: Array<{ runId: string }>;
  }>(
    await tempRuntime.registry.call("memory", tempRuntime.context(), {
      action: "working_set",
    }),
  );
  assert(
    workingSet.lastFilesRead.some((entry) => entry.includes("sample.json")),
    "P16 working_set did not retain recent file reads",
  );
  assert(
    workingSet.lastCommands.some((entry) =>
      entry.command.includes("working-set-command"),
    ),
    "P16 working_set did not retain recent commands",
  );
  assert(
    workingSet.workflowRuns.some(
      (entry) => entry.runId === startedWorkflow.runId,
    ),
    "P16 working_set did not surface workflow history",
  );
  checks.p16WorkingSet = {
    filesRead: workingSet.lastFilesRead.length,
    commands: workingSet.lastCommands.length,
    recentActions: workingSet.recentActions.length,
    workflowRuns: workingSet.workflowRuns.length,
  };

  const doctor = unwrap<{
    checks: Array<{ name: string; status: string }>;
    healthy: boolean;
  }>(
    await projectRuntime.registry.call("system", projectRuntime.context(), {
      action: "doctor",
    }),
  );
  for (const name of [
    "native-process",
    "release-manager",
    "document-intelligence",
    "workflow-engine",
  ]) {
    assert(
      doctor.checks.some(
        (entry) => entry.name === name && entry.status === "pass",
      ),
      `P18 doctor missing passing ${name} check`,
    );
  }
  checks.p18Observability = {
    healthy: doctor.healthy,
    newChecks: doctor.checks.filter((entry) =>
      [
        "native-process",
        "release-manager",
        "document-intelligence",
        "workflow-engine",
      ].includes(entry.name),
    ),
  };

  await Promise.all([projectRuntime.stop(), tempRuntime.stop()]);
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await shutdownPowerShellWorkers();
  await rm(root, { recursive: true, force: true });
}

async function waitForWorkflow(runtime: QnectorRuntime, runId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const run = unwrap<{
      runId: string;
      state: string;
      error?: string;
      steps: Array<{ state: string }>;
    }>(
      await runtime.registry.call("process", runtime.context(), {
        action: "workflow_status",
        runId,
      }),
    );
    if (run.state !== "pending" && run.state !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `P14 workflow ${runId} did not finish within acceptance timeout`,
  );
}

async function createFixtures(root: string): Promise<void> {
  await writeFile(
    path.join(root, "sample.json"),
    JSON.stringify(
      { product: "Qnector", stock: [{ sku: "GPU-A", qty: 5 }] },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(root, "sample.csv"),
    "sku,name,qty\nGPU-A,Widget,5\nGPU-B,Adapter,8\n",
    "utf8",
  );

  const docx = new AdmZip();
  docx.addFile(
    "word/document.xml",
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Qnector DOCX acceptance</w:t></w:r></w:p></w:body></w:document>',
      "utf8",
    ),
  );
  docx.addFile(
    "docProps/core.xml",
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Acceptance DOCX</dc:title><dc:creator>Qnector</dc:creator></cp:coreProperties>',
      "utf8",
    ),
  );
  docx.writeZip(path.join(root, "sample.docx"));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Branch", "SKU", "Qty"],
      ["Branch A", "GPU-A", 5],
      ["Branch B", "GPU-B", 8],
    ]),
    "Stock",
  );
  XLSX.writeFile(workbook, path.join(root, "sample.xlsx"));

  const zip = new AdmZip();
  zip.addFile("inside.txt", Buffer.from("Qnector ZIP acceptance", "utf8"));
  zip.addFile("folder/stock.csv", Buffer.from("sku,qty\nGPU-A,5\n", "utf8"));
  zip.writeZip(path.join(root, "sample.zip"));

  const sqlite = await import("node:sqlite");
  const DatabaseSync = (
    sqlite as unknown as {
      DatabaseSync: new (file: string) => {
        exec(sql: string): void;
        close(): void;
      };
    }
  ).DatabaseSync;
  const database = new DatabaseSync(path.join(root, "sample.sqlite"));
  try {
    database.exec(
      "CREATE TABLE inventory (sku TEXT PRIMARY KEY, qty INTEGER); INSERT INTO inventory VALUES ('GPU-A', 5), ('GPU-B', 8);",
    );
  } finally {
    database.close();
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  page.drawText("Qnector PDF acceptance", {
    x: 72,
    y: 760,
    size: 18,
    font,
  });
  await writeFile(path.join(root, "sample.pdf"), await pdf.save());
}

function unwrap<T>(result: ToolResult): T {
  if (!result.ok)
    throw new Error(
      `${result.error?.code ?? "TOOL_ERROR"}: ${result.error?.message ?? result.summary}`,
    );
  const outer = result.data as { data?: unknown } | undefined;
  return (outer?.data ?? outer) as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
