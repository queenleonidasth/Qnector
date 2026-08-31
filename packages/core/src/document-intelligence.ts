import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import * as XLSXImport from "xlsx";

const XLSX =
  (XLSXImport as typeof XLSXImport & { default?: typeof XLSXImport }).default ??
  XLSXImport;
import type { ToolAttachment } from "@qnector/shared";

export type DocumentKind =
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "json"
  | "zip"
  | "sqlite"
  | "text"
  | "unknown";

export interface DocumentInspection {
  path: string;
  kind: DocumentKind;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  metadata: Record<string, unknown>;
}

export interface DocumentTextResult {
  path: string;
  kind: DocumentKind;
  text: string;
  chars: number;
  truncated: boolean;
  metadata: Record<string, unknown>;
}

export interface DocumentRenderResult {
  path: string;
  kind: DocumentKind;
  page: number;
  pageCount: number;
  attachment: ToolAttachment;
}

export class DocumentIntelligenceService {
  public async inspect(file: string): Promise<DocumentInspection> {
    const absolute = path.resolve(file);
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error(`NOT_A_FILE: ${absolute}`);
    const kind = detectDocumentKind(absolute);
    const metadata = await this.metadata(absolute, kind);
    return {
      path: absolute,
      kind,
      extension: path.extname(absolute).toLowerCase(),
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      metadata,
    };
  }

  public async extractText(input: {
    path: string;
    maxChars?: number;
    page?: number;
    sheet?: string;
  }): Promise<DocumentTextResult> {
    const absolute = path.resolve(input.path);
    const inspection = await this.inspect(absolute);
    const maxChars = clamp(input.maxChars ?? 100_000, 1_000, 1_000_000);
    let text = "";
    const extra: Record<string, unknown> = {};

    switch (inspection.kind) {
      case "pdf": {
        const pdf = await loadPdf(absolute);
        const requested = input.page;
        const start = requested ? clamp(requested, 1, pdf.numPages) : 1;
        const end = requested ? start : pdf.numPages;
        const chunks: string[] = [];
        for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item) => ("str" in item ? String(item.str) : ""))
            .filter(Boolean)
            .join(" ");
          chunks.push(`[Page ${pageNumber}]\n${pageText}`);
          if (chunks.join("\n\n").length >= maxChars) break;
        }
        text = chunks.join("\n\n");
        extra.pageCount = pdf.numPages;
        if (requested) extra.page = start;
        await closePdf(pdf);
        break;
      }
      case "docx": {
        const zip = new AdmZip(absolute);
        const documentXml = zip
          .getEntry("word/document.xml")
          ?.getData()
          .toString("utf8");
        if (!documentXml)
          throw new Error(
            "DOCUMENT_PARSE_ERROR: DOCX is missing word/document.xml",
          );
        text = docxXmlToText(documentXml);
        const properties = zip
          .getEntry("docProps/core.xml")
          ?.getData()
          .toString("utf8");
        if (properties) Object.assign(extra, coreProperties(properties));
        break;
      }
      case "xlsx": {
        const workbook = XLSX.readFile(absolute, { cellDates: true });
        const selected = input.sheet
          ? workbook.SheetNames.filter((name) => name === input.sheet)
          : workbook.SheetNames;
        if (input.sheet && selected.length === 0)
          throw new Error(`DOCUMENT_SHEET_NOT_FOUND: ${input.sheet}`);
        text = selected
          .map((name) => {
            const sheet = workbook.Sheets[name];
            return `# Sheet: ${name}\n${sheet ? XLSX.utils.sheet_to_csv(sheet) : ""}`;
          })
          .join("\n\n");
        extra.sheets = workbook.SheetNames;
        break;
      }
      case "csv":
      case "text":
        text = await readFile(absolute, "utf8");
        break;
      case "json": {
        const raw = await readFile(absolute, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        text = JSON.stringify(parsed, null, 2);
        extra.rootType = Array.isArray(parsed) ? "array" : typeof parsed;
        break;
      }
      case "zip": {
        const zip = new AdmZip(absolute);
        const entries = zip.getEntries();
        text = entries
          .slice(0, 10_000)
          .map(
            (entry) =>
              `${entry.isDirectory ? "D" : "F"}\t${entry.header.size}\t${entry.entryName}`,
          )
          .join("\n");
        extra.entryCount = entries.length;
        break;
      }
      case "sqlite": {
        const schema = await sqliteQuery(
          absolute,
          "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','view','index','trigger') ORDER BY type,name LIMIT 500",
        );
        text = JSON.stringify(schema, null, 2);
        extra.rows = schema.length;
        break;
      }
      default:
        throw new Error(
          `UNSUPPORTED_DOCUMENT: cannot extract structured text from ${inspection.extension || "this file type"}`,
        );
    }

    const truncated = text.length > maxChars;
    const bounded = text.slice(0, maxChars);
    return {
      path: absolute,
      kind: inspection.kind,
      text: bounded,
      chars: bounded.length,
      truncated,
      metadata: { ...inspection.metadata, ...extra },
    };
  }

  public async render(input: {
    path: string;
    page?: number;
    maxWidth?: number;
    format?: "png" | "jpeg";
  }): Promise<DocumentRenderResult> {
    const absolute = path.resolve(input.path);
    const kind = detectDocumentKind(absolute);
    if (kind !== "pdf")
      throw new Error(
        "UNSUPPORTED_DOCUMENT_RENDER: files.render currently renders PDF pages; use files.preview for images and files.extract_text for other documents",
      );
    const pdf = await loadPdf(absolute);
    const pageNumber = clamp(input.page ?? 1, 1, pdf.numPages);
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const maxWidth = clamp(input.maxWidth ?? 2048, 320, 4096);
    const scale = Math.min(4, maxWidth / Math.max(1, base.width));
    const viewport = page.getViewport({ scale });
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context as never, viewport } as never)
      .promise;
    const format = input.format ?? "png";
    const buffer =
      format === "jpeg"
        ? canvas.toBuffer("image/jpeg")
        : canvas.toBuffer("image/png");
    const attachment: ToolAttachment = {
      type: "image",
      mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
      dataBase64: buffer.toString("base64"),
      width: canvas.width,
      height: canvas.height,
      sizeBytes: buffer.length,
    };
    const result = {
      path: absolute,
      kind,
      page: pageNumber,
      pageCount: pdf.numPages,
      attachment,
    } satisfies DocumentRenderResult;
    await closePdf(pdf);
    return result;
  }

  public async query(input: {
    path: string;
    sql: string;
    maxRows?: number;
  }): Promise<{
    path: string;
    kind: "sqlite";
    rows: unknown[];
    truncated: boolean;
  }> {
    const absolute = path.resolve(input.path);
    if (detectDocumentKind(absolute) !== "sqlite")
      throw new Error(
        "UNSUPPORTED_DOCUMENT_QUERY: document_query currently supports SQLite database files",
      );
    const maxRows = clamp(input.maxRows ?? 200, 1, 2_000);
    const sql = input.sql.trim();
    if (!sql) throw new Error("INVALID_INPUT: sql is required");
    const rows = await sqliteQuery(absolute, sql);
    return {
      path: absolute,
      kind: "sqlite",
      rows: rows.slice(0, maxRows),
      truncated: rows.length > maxRows,
    };
  }

  private async metadata(
    file: string,
    kind: DocumentKind,
  ): Promise<Record<string, unknown>> {
    if (kind === "pdf") {
      const pdf = await loadPdf(file);
      let metadata: unknown = null;
      try {
        metadata = (await pdf.getMetadata()).info;
      } catch {
        metadata = null;
      }
      const result = { pageCount: pdf.numPages, info: metadata };
      await closePdf(pdf);
      return result;
    }
    if (kind === "xlsx") {
      const workbook = XLSX.readFile(file, {
        bookSheets: true,
        bookProps: true,
      });
      return {
        sheets: workbook.SheetNames,
        properties: workbook.Props ?? null,
      };
    }
    if (kind === "docx" || kind === "zip") {
      const zip = new AdmZip(file);
      const entries = zip.getEntries();
      const result: Record<string, unknown> = {
        entryCount: entries.length,
        entries: entries.slice(0, 100).map((entry) => ({
          name: entry.entryName,
          directory: entry.isDirectory,
          sizeBytes: entry.header.size,
        })),
      };
      if (kind === "docx") {
        const properties = zip
          .getEntry("docProps/core.xml")
          ?.getData()
          .toString("utf8");
        if (properties) result.properties = coreProperties(properties);
      }
      return result;
    }
    if (kind === "json") {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
      return {
        rootType: Array.isArray(parsed) ? "array" : typeof parsed,
        ...(parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? {
              topLevelKeys: Object.keys(
                parsed as Record<string, unknown>,
              ).slice(0, 200),
            }
          : {}),
        ...(Array.isArray(parsed) ? { length: parsed.length } : {}),
      };
    }
    if (kind === "csv") {
      const raw = (await readFile(file, "utf8")).slice(0, 1_000_000);
      const lines = raw.split(/\r?\n/).filter(Boolean);
      return {
        sampledRows: Math.max(0, lines.length - 1),
        headers: lines[0] ? parseCsvLine(lines[0]).slice(0, 200) : [],
      };
    }
    if (kind === "sqlite") {
      const rows = await sqliteQuery(
        file,
        "SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table','view') ORDER BY type,name LIMIT 500",
      );
      return { objects: rows };
    }
    return {};
  }
}

export function detectDocumentKind(file: string): DocumentKind {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if ([".xlsx", ".xlsm", ".xlsb", ".xls"].includes(ext)) return "xlsx";
  if (ext === ".csv" || ext === ".tsv") return "csv";
  if (ext === ".json" || ext === ".jsonc") return "json";
  if (ext === ".zip") return "zip";
  if ([".sqlite", ".sqlite3", ".db"].includes(ext)) return "sqlite";
  if (
    [
      ".txt",
      ".md",
      ".log",
      ".xml",
      ".html",
      ".htm",
      ".yaml",
      ".yml",
      ".ini",
      ".toml",
    ].includes(ext)
  )
    return "text";
  return "unknown";
}

async function closePdf(pdf: unknown): Promise<void> {
  const value = pdf as {
    destroy?: () => Promise<void> | void;
    cleanup?: () => void;
  };
  if (typeof value.destroy === "function") await value.destroy();
  else value.cleanup?.();
}

async function loadPdf(file: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(file));
  return pdfjs.getDocument({ data, useSystemFonts: true }).promise;
}

function docxXmlToText(xml: string): string {
  return decodeXml(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function coreProperties(xml: string): Record<string, string> {
  const tags = [
    "dc:title",
    "dc:subject",
    "dc:creator",
    "cp:lastModifiedBy",
    "dcterms:created",
    "dcterms:modified",
  ];
  const result: Record<string, string> = {};
  for (const tag of tags) {
    const match = xml.match(
      new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
    );
    if (match?.[1])
      result[tag.replace(/^.*:/, "")] = decodeXml(
        match[1].replace(/<[^>]+>/g, ""),
      ).trim();
  }
  return result;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else current += char;
  }
  result.push(current);
  return result;
}

async function sqliteQuery(file: string, sql: string): Promise<unknown[]> {
  try {
    const sqlite = await import("node:sqlite");
    const DatabaseSync = (
      sqlite as unknown as {
        DatabaseSync: new (
          file: string,
          options?: { readOnly?: boolean },
        ) => {
          prepare(statement: string): { all(): unknown[] };
          close(): void;
        };
      }
    ).DatabaseSync;
    const database = new DatabaseSync(file, { readOnly: true });
    try {
      return database.prepare(sql).all();
    } finally {
      database.close();
    }
  } catch (error) {
    throw new Error(
      `SQLITE_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
