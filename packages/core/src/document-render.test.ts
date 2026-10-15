import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentIntelligenceService } from "./document-intelligence.js";
import { clearDocumentSessions } from "./document-session.js";

let root: string | undefined;
afterEach(async () => {
  clearDocumentSessions();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
async function createDocument(): Promise<string> {
  root = await mkdtemp(path.join(os.tmpdir(), "qnector-real-pdf-render-"));
  const pdf = await PDFDocument.create();
  for(let i=0;i<3;i++)pdf.addPage([612,792]);
  const file = path.join(root,"blank-scan.pdf");
  await writeFile(file, await pdf.save());
  return file;
}

describe("real PDF rendering and scanned-text fallback", () => {
  it("renders a full resolution page at requested width, preserves page count and image bytes", async () => {
    const file = await createDocument();
    const service = new DocumentIntelligenceService();
    const inspection = await service.inspect(file);
    expect(inspection.metadata.pageCount).toBe(3);
    const second = await service.render({path:file,page:2,maxWidth:640,format:"png"});
    expect(second.page).toBe(2);
    expect(second.pageCount).toBe(3);
    expect(second.attachment.mimeType).toBe("image/png");
    expect(second.attachment.width).toBeGreaterThan(0);
    expect(second.attachment.width).toBeLessThanOrEqual(640);
    const bytes=Buffer.from(second.attachment.dataBase64,"base64");
    expect(bytes.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(second.attachment.sizeBytes).toBe(bytes.length);
    const first=await service.render({path:file,page:1,maxWidth:1024,format:"png"});
    expect(first.attachment.width).toBeGreaterThan(second.attachment.width!);
    const text=await service.extractText({path:file});
    expect(text.kind).toBe("pdf");
    expect(text.metadata.pageCount).toBe(3);
    expect(text.text).toContain("[Page 3]");
    expect(text.text).not.toContain("ภาษาไทย");
  });

  it("does not confuse a corrupt PDF with a successful render or OCR extraction", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "qnector-corrupt-pdf-"));
    const file=path.join(root,"invalid.pdf");
    await writeFile(file,Buffer.from("%PDF-1.7\nnot a valid document"));
    const service=new DocumentIntelligenceService();
    await expect(service.render({path:file,page:1})).rejects.toThrow();
    await expect(service.extractText({path:file})).rejects.toThrow();
  });
});
