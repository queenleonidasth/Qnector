---
name: archive-workflows
description: Inspect, test, extract, create, compare, and troubleshoot ZIP, 7z, RAR, TAR, GZ and compressed archives. Trigger for zip, unzip, archive, extract, compress, แตกไฟล์, ไฟล์ zip, บีบอัด, แพ็กไฟล์, เปิดไฟล์บีบอัด, or checking archive contents.
license: MIT
compatibility: Qnector 0.4.9+; 7-Zip CLI recommended and detected with system.which
allowed-tools: system files process workspace
---

# Archive Workflows

Use this skill for compressed/archive files. Prefer the installed 7-Zip CLI because it handles ZIP, 7z, RAR, TAR, GZ and many related formats consistently on Windows.

## Workflow

1. Identify the archive and intended operation: inspect/list, test integrity, extract, create/update, or compare.
2. Run `system.which` for `7z` before using CLI operations. If unavailable, use Qnector native ZIP inspection where possible and report the missing provider instead of guessing.
3. For an unfamiliar archive, inspect first with `7z l -slt <archive>` before extracting. Summarize file count, total/uncompressed size, top-level layout, and suspiciously deep or unexpected paths.
4. Test integrity with `7z t <archive>` before destructive replacement or when the user reports corruption.
5. Extract to an explicit destination directory. Create the destination first and avoid mixing extracted files into the source project root unless that is clearly intended.
6. After extraction, inspect the resulting tree and verify expected files exist. For software packages, read the README/manifest before running anything.
7. When creating an archive, archive the requested files only, then run `7z t` against the result and report final size/hash when useful.
8. Preserve the original archive unless the user explicitly asks to replace/delete it.

## Common commands

- Detailed list: `7z l -slt "archive.zip"`
- Integrity test: `7z t "archive.zip"`
- Extract with paths: `7z x "archive.zip" -o"destination"`
- Create ZIP: set `process.cwd` to the folder whose contents should become the archive, then run `7z a -tzip "C:\\path\\output.zip" ".\\*"`
- Create 7z: set `process.cwd` to the folder whose contents should become the archive, then run `7z a -t7z "C:\\path\\output.7z" ".\\*"`

Use Qnector `process` for these commands so output and exit codes are captured. Quote every path containing spaces. Choose `cwd` deliberately: passing a long relative input path can preserve that directory chain inside the archive, which is often not the layout the user expects.

## Archive QC

Before reporting success, verify:

- CLI exit code is 0.
- Integrity test passes when the operation produced or modified an archive.
- Extracted/archived file count is plausible.
- Required project files are present.
- No unexpected overwrite occurred.
- The original archive remains available unless deletion was requested.

## Large archives

Do not dump huge listings into model context. Use bounded command output, filename filtering, or targeted directory inspection. For very large archives, inspect metadata first and extract only the required subtree when practical.
