---
name: document-workflows
description: "Read, inspect, convert, edit, and QC document files including PDF, DOCX, PPTX, ODT, EPUB, RTF, MSG, images, and other Office-style formats while preserving the original structure whenever possible."
license: MIT
compatibility: "Qnector 0.4.9+; optional MarkItDown/LibreOffice/Python document libraries improve coverage"
allowed-tools: [system, files, process, workspace]
---

# Document Workflows

Use this skill for document-heavy work rather than treating binary files as plain text.

## Read and inspect

1. Start with `files.inspect` and `files.extract_text` for Qnector-native formats.
2. For PDF layout questions, render the relevant page and inspect the image rather than relying only on extracted text.
3. For unsupported formats, check available providers. If MarkItDown is installed, use Qnector's document fallback or `python -m markitdown <file>` for semantic extraction.
4. Keep extraction bounded. Narrow to the needed page, sheet, or section when possible.

## Edit

1. Never overwrite a binary document by writing extracted Markdown/text back to the same filename.
2. Prefer a structure-aware library/provider for the format: OOXML tools for DOCX/PPTX/XLSX, LibreOffice headless conversion/editing when available, or a dedicated format library.
3. Read the target immediately before editing and preserve an untouched original unless the user explicitly requests in-place modification.
4. For automated replacements, verify the target count and avoid blind replacement inside package XML unless the edit is intentionally low-level.

## QC

- Re-open or re-extract the edited file to verify content.
- For layout-sensitive documents, convert/render to PDF or images and visually inspect representative pages/slides.
- Confirm page/slide/sheet counts, filenames, and output size before reporting success.
