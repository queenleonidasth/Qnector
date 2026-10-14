import { describe, expect, it, vi } from "vitest";
import { clearDocumentSessions, withDocumentSession } from "./document-session.js";
import { DocumentIntelligenceService } from "./document-intelligence.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const parser = vi.hoisted(() => ({ opens: 0, closes: 0 }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => {
    parser.opens += 1;
    return { promise: Promise.resolve({
      numPages: 1,
      getMetadata: async () => ({ info: { Title: "Thai report" } }),
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "ภาษาไทย" }] }) }),
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
    const root = await mkdtemp(path.join(tmpdir(), "qnector-pdf-session-"));
    try {
      const file = path.join(root, "report.pdf");
      await writeFile(file, "%PDF test bytes");
      const service = new DocumentIntelligenceService();
      const first = await service.extractText({ path: file });
      const second = await service.extractText({ path: file });
      expect(first.text).toContain("ภาษาไทย");
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
});
