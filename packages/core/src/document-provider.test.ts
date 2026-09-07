import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectDocumentKind,
  DocumentIntelligenceService,
} from "./document-intelligence.js";

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("DocumentIntelligenceService optional providers", () => {
  it("routes extended document formats to the MarkItDown provider", () => {
    expect(detectDocumentKind("slides.pptx")).toBe("markitdown");
    expect(detectDocumentKind("notes.ipynb")).toBe("markitdown");
    expect(detectDocumentKind("book.epub")).toBe("markitdown");
  });

  it("extracts an extended local format when MarkItDown is installed", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-markitdown-"));
    const file = path.join(root, "notes.ipynb");
    await writeFile(
      file,
      JSON.stringify({
        cells: [
          {
            cell_type: "markdown",
            metadata: {},
            source: [
              "# Qnector Provider\n",
              "Extended document extraction works.",
            ],
          },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
      "utf8",
    );
    const service = new DocumentIntelligenceService();
    const providers = await service.providers();
    if (!providers.markitdown.available) return;
    const result = await service.extractText({ path: file });
    expect(result.kind).toBe("markitdown");
    expect(result.text).toContain("Qnector Provider");
    expect(result.metadata.provider).toBe("markitdown");
  });
});
