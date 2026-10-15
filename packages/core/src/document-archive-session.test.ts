import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import * as XLSXImport from "xlsx";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentIntelligenceService } from "./document-intelligence.js";
import { clearDocumentSessions } from "./document-session.js";

const XLSX = (XLSXImport as typeof XLSXImport & {default?: typeof XLSXImport}).default ?? XLSXImport;
let root: string | undefined;
afterEach(async () => {
  clearDocumentSessions();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
async function files(): Promise<string> {
  root = await mkdtemp(path.join(os.tmpdir(), "qnector-archive-session-"));
  return root;
}
function workbookBytes(value: string): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "ยอดขาย"], ["สมุด", value]]), "Thai");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Value"], ["Other", "SECOND_SHEET"]]), "English");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("versioned workbook and archive session extraction", () => {
  it("keeps Thai XLSX sheet selectors isolated and invalidates cache on changed bytes", async () => {
    const file = path.join(await files(), "thai.xlsx");
    const service = new DocumentIntelligenceService();
    await writeFile(file, workbookBytes("v1"));
    const thai = await service.extractText({ path: file, sheet: "Thai" });
    expect(thai.text).toContain("ยอดขาย");
    expect(thai.text).toContain("v1");
    expect(thai.text).not.toContain("SECOND_SHEET");
    const again = await service.extractText({ path: file, sheet: "Thai" });
    expect(again).toEqual(thai);
    const english = await service.extractText({ path: file, sheet: "English" });
    expect(english.text).toContain("SECOND_SHEET");
    expect(english.text).not.toContain("ยอดขาย");
    await expect(service.extractText({ path: file, sheet: "missing" })).rejects.toThrow("DOCUMENT_SHEET_NOT_FOUND");
    await writeFile(file, workbookBytes("v2"));
    const changed = await service.extractText({ path: file, sheet: "Thai" });
    expect(changed.text).toContain("v2");
    expect(changed.text).not.toContain("v1");
  });

  it("keeps ZIP and DOCX text and archive metadata snapshot-consistent", async () => {
    const directory = await files();
    const service = new DocumentIntelligenceService();
    const zip = new AdmZip();
    zip.addFile("ภาษาไทย.txt", Buffer.from("Thai archive"));
    const file = path.join(directory, "content.zip");
    await writeFile(file, zip.toBuffer());
    const first = await service.extractText({ path: file });
    expect(first.kind).toBe("zip");
    expect(first.text).toContain("ภาษาไทย.txt");
    expect(first.metadata.entryCount).toBe(1);
    expect(await service.extractText({ path: file })).toEqual(first);
    const updated = new AdmZip();
    updated.addFile("ใหม่.txt", Buffer.from("changed"));
    updated.addFile("extra.txt", Buffer.from("extra"));
    await writeFile(file, updated.toBuffer());
    const next = await service.extractText({ path: file });
    expect(next.text).toContain("ใหม่.txt");
    expect(next.text).not.toContain("ภาษาไทย.txt");
    expect(next.metadata.entryCount).toBe(2);

    const docx = new AdmZip();
    docx.addFile("word/document.xml", Buffer.from(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ภาษาไทย</w:t></w:r></w:p></w:body></w:document>',
    ));
    const docxFile = path.join(directory, "thai.docx");
    await writeFile(docxFile, docx.toBuffer());
    const document = await service.extractText({ path: docxFile });
    expect(document.kind).toBe("docx");
    expect(document.text).toContain("ภาษาไทย");
    expect(await service.extractText({ path: docxFile })).toEqual(document);
  });

  it("does not return a prior successful result after an invalid archive revision", async () => {
    const directory = await files();
    const service = new DocumentIntelligenceService();
    const file = path.join(directory, "report.zip");
    const zip = new AdmZip();
    zip.addFile("valid.txt", Buffer.from("valid"));
    await writeFile(file, zip.toBuffer());
    expect((await service.extractText({ path: file })).text).toContain("valid.txt");
    await writeFile(file, Buffer.from("invalid zip bytes"));
    await expect(service.extractText({ path: file })).rejects.toThrow();
  });
});
