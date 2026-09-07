---
name: spreadsheet-workflows
description: "Analyze, compare, clean, and structure-preservingly edit XLSX/XLS/CSV/TSV spreadsheets; inspect sheets and formulas, use openpyxl or pandas when appropriate, and validate outputs after changes."
license: MIT
compatibility: "Qnector 0.4.9+; openpyxl/pandas recommended for structure-aware edits"
allowed-tools: [system, files, process, workspace]
---

# Spreadsheet Workflows

Use this skill for Excel and tabular-data tasks.

## Inspect before editing

1. Use `files.inspect` to list workbook sheets and metadata, then `files.extract_text` on the relevant sheet for a bounded content view.
2. Determine whether the task needs structure preservation. CSV-style extraction is good for analysis but is not a safe round-trip representation of a formatted workbook.
3. Check formulas, merged cells, hidden sheets, formatting, named ranges, and data validation when they matter to the request.

## Edit strategy

- Use `openpyxl` for XLSX when formulas, styles, dimensions, merges, comments, or workbook structure must be preserved.
- Use `pandas` for analysis/transformation of table-shaped data; do not use it as the only writer for a workbook whose formatting must remain intact.
- Use CSV/TSV only when the source/output is genuinely delimited text.
- Never replace a binary XLSX by writing extracted CSV text into it.

## Validation

1. Re-open the output with a structure-aware reader.
2. Verify sheet names, dimensions, formulas or expected values, and any formatting requirements the user mentioned.
3. When formulas were changed, recalculate with an available spreadsheet engine (for example LibreOffice) when possible; otherwise clearly report that cached formula results were not recalculated.
4. Compare key rows/cells against the original for accidental data loss.
