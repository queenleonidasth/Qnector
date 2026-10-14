import { describe, expect, it, vi } from "vitest";
import { clearDocumentSessions, withDocumentSession } from "./document-session.js";
import { DocumentIntelligenceService } from "./document-intelligence.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

async function createPdfFixture(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([612, 792]);
  return pdf.save();
}

const parser = vi.hoisted(() => ({ opens: 0, closes: 0, pages: 1, fail: false }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => {
    parser.opens += 1;
    if (parser.fail) return { promise: Promise.reject(new Error("Invalid PDF structure")) };
    return { promise: Promise.resolve({
      numPages: parser.pages,
      getMetadata: async () => ({ info: { Title: "Thai report" } }),
      getPage: async (pageNumber: number) => ({ getTextContent: async () => ({ items: [{ str: pageNumber === 2 || parser.pages === 1 ? "ภาษาไทย" : `Page ${pageNumber}` }] }) }),
      destroy: async () => { parser.closes += 1; },
    }) };
  },
}));

describe("document sessions", () => {
  it("deduplicates concurrent reads and caches only the same revision", async () => {
    clearDocumentSessions();
    let loads = 0;
    const loader = async () => { loads += 1; await Promise.resolve(); return { text: "สวัสดี" }; };
    const [a, b] = await Promise.all([
      withDocumentSession("/a.pdf", "sha-a|page=1", loader),
      withDocumentSession("/a.pdf", "sha-a|page=1", loader),
    ]);
    expect(a).toEqual(b);
    expect(loads).toBe(1);
    expect((await withDocumentSession("/a.pdf", "sha-b|page=1", loader)).text).toBe("สวัสดี");
    expect(loads).toBe(2);
  });

  it("extracts Thai PDF text with metadata from one parser and reuses its unchanged result", async () => {
    clearDocumentSessions();
    parser.opens = 0;
    parser.closes = 0;
    parser.pages = 1;
    const root = await mkdtemp(path.join(tmpdir(), "qnector-pdf-session-"));
    try {
      const file = path.join(root, "report.pdf");
      await writeFile(file, await createPdfFixture(1));
      const service = new DocumentIntelligenceService();
      const first = await service.extractText({ path: file });
      const second = await service.extractText({ path: file });
      expect(first.text).toContain("Page 1");
      expect(first.metadata.pageCount).toBe(1);
      expect(first.metadata.info).toEqual({ Title: "Thai report" });
      expect(second).toEqual(first);
      expect(parser.opens).toBe(1);
      expect(parser.closes).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
      clearDocumentSessions();
    }
  });

  it("extracts all pages and supports page selection with Thai text intact", async () => {
    clearDocumentSessions();
    parser.opens = 0;
    parser.closes = 0;
    parser.pages = 3;
    const root = await mkdtemp(path.join(tmpdir(), "qnector-pdf-pages-"));
    try {
      const file = path.join(root, "multi.pdf");
      await writeFile(file, await createPdfFixture(3));
      const service = new DocumentIntelligenceService();
      const all = await service.extractText({ path: file });
      expect(all.text).toContain("[Page 1]");
      expect(all.text).toContain("[Page 2]\nภาษาไทย");
      expect(all.text).toContain("[Page 3]");
      expect(all.metadata.pageCount).toBe(3);
      const selected = await service.extractText({ path: file, page: 2 });
      expect(selected.text).toContain("ภาษาไทย");
      expect(selected.text).not.toContain("[Page 1]");
      expect(selected.metadata.page).toBe(2);
      expect(parser.opens).toBe(2);
      expect(parser.closes).toBe(2);
    } finally {
      parser.pages = 1;
      await rm(root, { recursive: true, force: true });
      clearDocumentSessions();
    }
  });

  it("propagates corrupt PDF errors and does not cache failed parses", async () => {
    clearDocumentSessions();
    parser.opens = 0;
    parser.closes = 0;
    parser.fail = true;
    const root = await mkdtemp(path.join(tmpdir(), "qnector-pdf-corrupt-"));
    try {
      const file = path.join(root, "broken.pdf");
      await writeFile(file, "%PDF corrupt fixture");
      const service = new DocumentIntelligenceService();
      await expect(service.extractText({ path: file })).rejects.toThrow("Invalid PDF structure");
      await expect(service.extractText({ path: file })).rejects.toThrow("Invalid PDF structure");
      expect(parser.opens).toBe(2);
      expect(parser.closes).toBe(0);
    } finally {
      parser.fail = false;
      await rm(root, { recursive: true, force: true });
      clearDocumentSessions();
    }
  });
});
