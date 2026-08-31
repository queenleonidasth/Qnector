import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  ToolAttachment,
  ToolDefinition,
  ToolResult,
} from "@qnector/shared";
import {
  booleanInput,
  numberInput,
  objectInput,
  runWithActivity,
  stringInput,
  type ToolContext,
} from "./tool-result.js";

export const filesDefinition: ToolDefinition = {
  name: "files",
  description:
    "Read, preview images, create, edit, patch, move, copy, hash, or delete local files. files.preview returns PNG/JPEG/WEBP as an MCP image attachment so ChatGPT can inspect the image directly. Relative paths resolve from the active Qnector workspace; absolute paths are supported. Prefer read before edit, apply_patch for multi-file changes, and return a concise change summary.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "read",
          "read_many",
          "preview",
          "inspect",
          "extract_text",
          "render",
          "document_query",
          "write",
          "append",
          "replace",
          "multi_edit",
          "apply_patch",
          "mkdir",
          "move",
          "copy",
          "delete",
          "hash",
        ],
      },
      path: { type: "string" },
      paths: { type: "array", items: { type: "string" } },
      content: { type: "string" },
      contentBase64: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
      replaceAll: { type: "boolean" },
      edits: { type: "array" },
      patch: { type: "string" },
      destination: { type: "string" },
      offsetLine: { type: "integer", minimum: 1 },
      limitLines: { type: "integer", minimum: 1 },
      maxChars: { type: "integer", minimum: 1 },
      page: { type: "integer", minimum: 1 },
      sheet: { type: "string" },
      sql: { type: "string" },
      maxRows: { type: "integer", minimum: 1, maximum: 2000 },
      encoding: { type: "string", enum: ["utf8", "base64"] },
      format: { type: "string", enum: ["png", "jpeg"] },
      maxWidth: { type: "integer", minimum: 320, maximum: 4096 },
      expectedSha256: { type: "string" },
      recursive: { type: "boolean" },
    },
    required: ["action"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

interface ChangedFile {
  path: string;
  operation: string;
  bytes: number;
  sha256: string;
}

export async function executeFiles(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(context, "files", action, input, async () => {
    if (action === "read") return readFileAction(context, object);
    if (action === "read_many") return readManyAction(context, object);
    if (action === "preview") return previewFileAction(context, object);
    if (
      ["inspect", "extract_text", "render", "document_query"].includes(action)
    ) {
      if (!context.documentIntelligence)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: document intelligence is not configured in this Qnector runtime",
        );
      const target = context.workspace.resolve(
        stringInput(object, "path", true)!,
      );
      if (action === "inspect") {
        const result = await context.documentIntelligence.inspect(target);
        return {
          summary: `Inspected ${result.kind} document ${target}`,
          data: result,
        };
      }
      if (action === "extract_text") {
        const result = await context.documentIntelligence.extractText({
          path: target,
          maxChars: numberInput(object, "maxChars", 100_000),
          ...(object.page === undefined
            ? {}
            : { page: numberInput(object, "page", 1) }),
          ...(stringInput(object, "sheet")
            ? { sheet: stringInput(object, "sheet") }
            : {}),
        });
        return {
          summary: `Extracted ${result.chars} character(s) from ${result.kind} document`,
          data: result,
          truncated: result.truncated,
        };
      }
      if (action === "render") {
        const format = stringInput(object, "format") as
          "png" | "jpeg" | undefined;
        const result = await context.documentIntelligence.render({
          path: target,
          page: numberInput(object, "page", 1),
          maxWidth: numberInput(object, "maxWidth", 2048),
          ...(format ? { format } : {}),
        });
        return {
          summary: `Rendered ${result.kind} page ${result.page}/${result.pageCount}`,
          data: {
            path: result.path,
            kind: result.kind,
            page: result.page,
            pageCount: result.pageCount,
            mimeType: result.attachment.mimeType,
            width: result.attachment.width,
            height: result.attachment.height,
            sizeBytes: result.attachment.sizeBytes,
          },
          attachments: [result.attachment],
        };
      }
      const result = await context.documentIntelligence.query({
        path: target,
        sql: stringInput(object, "sql", true)!,
        maxRows: numberInput(object, "maxRows", 200),
      });
      return {
        summary: `SQLite document query returned ${result.rows.length} row(s)`,
        data: result,
        truncated: result.truncated,
      };
    }
    if (action === "write" || action === "append")
      return writeFileAction(context, object, action);
    if (action === "replace") return replaceFileAction(context, object);
    if (action === "multi_edit") return multiEditAction(context, object);
    if (action === "apply_patch") return applyPatchAction(context, object);
    if (action === "mkdir") {
      const target = context.workspace.resolve(
        stringInput(object, "path", true)!,
      );
      await mkdir(target, { recursive: true });
      await recordFileChange(context, `Created directory ${target}`, [target]);
      return {
        summary: `Created directory ${target}`,
        data: { path: target, operation: "mkdir" },
      };
    }
    if (action === "move" || action === "copy") {
      const source = context.workspace.resolve(
        stringInput(object, "path", true)!,
      );
      const destination = context.workspace.resolve(
        stringInput(object, "destination", true)!,
      );
      if (action === "move") await rename(source, destination);
      else await copyFile(source, destination);
      const info = await stat(destination);
      await recordFileChange(
        context,
        `${action === "move" ? "Moved" : "Copied"} ${source} to ${destination}`,
        [source, destination],
      );
      return {
        summary: `${action === "move" ? "Moved" : "Copied"} ${source} to ${destination}`,
        data: { source, destination, operation: action, bytes: info.size },
      };
    }
    if (action === "delete") {
      const target = context.workspace.resolve(
        stringInput(object, "path", true)!,
      );
      const recursive = booleanInput(object, "recursive", true);
      await rm(target, { recursive, force: false });
      await recordFileChange(context, `Deleted ${target}`, [target]);
      return {
        summary: `Deleted ${target}`,
        data: { path: target, operation: "delete", recursive },
      };
    }
    if (action === "hash") {
      const target = context.workspace.resolve(
        stringInput(object, "path", true)!,
      );
      const sha256 = await hashFile(target);
      return { summary: `Hashed ${target}`, data: { path: target, sha256 } };
    }
    throw new Error(`INVALID_ACTION: Unknown files action '${action}'`);
  });
}

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

type PreviewMimeType = "image/png" | "image/jpeg" | "image/webp";

async function previewFileAction(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const target = context.workspace.resolve(stringInput(input, "path", true)!);
  const file = await stat(target);
  if (!file.isFile())
    throw new Error(`INVALID_INPUT: preview path is not a file: ${target}`);

  const headerLength = Math.min(file.size, 256 * 1024);
  const handle = await open(target, "r");
  let header: Buffer;
  try {
    header = Buffer.alloc(headerLength);
    const result = await handle.read(header, 0, headerLength, 0);
    header = header.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
  const image = inspectPreviewImage(header);
  if (!image)
    throw new Error(
      "UNSUPPORTED_PREVIEW: files.preview supports PNG, JPEG, and WEBP images",
    );

  const requestedMaxWidth = Math.max(
    320,
    Math.min(4_096, Math.floor(numberInput(input, "maxWidth", 2_048))),
  );
  const requestedFormat = stringInput(input, "format");
  if (
    requestedFormat &&
    requestedFormat !== "png" &&
    requestedFormat !== "jpeg"
  )
    throw new Error("INVALID_INPUT: format must be png or jpeg");
  const shouldTransform =
    Boolean(requestedFormat) ||
    file.size > MAX_PREVIEW_BYTES ||
    (image.width !== undefined && image.width > requestedMaxWidth);

  let attachment: ToolAttachment;
  let transformed = false;
  if (shouldTransform && context.platform?.previewImage) {
    attachment = await context.platform.previewImage({
      path: target,
      maxWidth: requestedMaxWidth,
      format: requestedFormat === "png" ? "png" : "jpeg",
    });
    transformed = true;
  } else {
    if (file.size > MAX_PREVIEW_BYTES)
      throw new Error(
        `PREVIEW_TOO_LARGE: image is ${file.size} bytes; this runtime cannot resize it before the ${MAX_PREVIEW_BYTES}-byte attachment limit`,
      );
    const buffer = await readFile(target);
    attachment = {
      type: "image" as const,
      mimeType: image.mimeType,
      dataBase64: buffer.toString("base64"),
      width: image.width,
      height: image.height,
      sizeBytes: buffer.length,
    };
  }

  return {
    summary: `Previewed ${attachment.mimeType} image ${target}`,
    data: {
      path: target,
      type: "image",
      sourceMimeType: image.mimeType,
      mimeType: attachment.mimeType,
      sourceWidth: image.width,
      sourceHeight: image.height,
      width: attachment.width,
      height: attachment.height,
      sourceSizeBytes: file.size,
      sizeBytes: attachment.sizeBytes,
      transformed,
    },
    attachments: [attachment],
  };
}

function inspectPreviewImage(
  buffer: Buffer,
): { mimeType: PreviewMimeType; width?: number; height?: number } | null {
  if (
    buffer.length >= 24 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return {
      mimeType: "image/png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8)
    return { mimeType: "image/jpeg", ...jpegDimensions(buffer) };

  if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return { mimeType: "image/webp", ...webpDimensions(buffer) };

  return null;
}

function jpegDimensions(buffer: Buffer): { width?: number; height?: number } {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (isJpegStartOfFrame(marker) && length >= 7)
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    offset += length;
  }
  return {};
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function webpDimensions(buffer: Buffer): { width?: number; height?: number } {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30)
    return {
      width: 1 + readUInt24LE(buffer, 24),
      height: 1 + readUInt24LE(buffer, 27),
    };
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b1 = buffer[21]!;
    const b2 = buffer[22]!;
    const b3 = buffer[23]!;
    const b4 = buffer[24]!;
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  if (
    chunk === "VP8 " &&
    buffer.length >= 30 &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  )
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  return {};
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return (
    buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16)
  );
}

async function readFileAction(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const target = context.workspace.resolve(stringInput(input, "path", true)!);
  const encoding = stringInput(input, "encoding") ?? "utf8";
  const info = await stat(target);
  if (!info.isFile()) throw new Error(`NOT_A_FILE: ${target}`);
  const sha256 = await hashFile(target);
  if (encoding === "base64") {
    const buffer = await readFile(target);
    return {
      summary: `Read ${buffer.length} bytes from ${target}`,
      data: {
        path: target,
        encoding,
        contentBase64: buffer.toString("base64"),
        bytes: buffer.length,
        sha256,
      },
    };
  }
  const content = await readFile(target, "utf8");
  const allLines = content.split(/\r?\n/);
  if (allLines.at(-1) === "") allLines.pop();
  const offsetLine = Math.max(
    1,
    Math.floor(numberInput(input, "offsetLine", 1)),
  );
  const limitLines = Math.max(
    1,
    Math.min(Math.floor(numberInput(input, "limitLines", 200)), 10_000),
  );
  const selected = allLines.slice(offsetLine - 1, offsetLine - 1 + limitLines);
  const numbered = selected
    .map(
      (line, index) =>
        `${String(offsetLine + index).padStart(6, " ")} | ${line}`,
    )
    .join("\n");
  const truncated = offsetLine - 1 + selected.length < allLines.length;
  return {
    summary: `Read ${selected.length} line(s) from ${target}`,
    data: {
      path: target,
      encoding,
      content: numbered,
      lines: selected.length,
      startLine: selected.length ? offsetLine : null,
      endLine: selected.length ? offsetLine + selected.length - 1 : null,
      totalLines: allLines.length,
      sha256,
      truncated,
      nextOffsetLine: truncated ? offsetLine + selected.length : null,
    },
    truncated,
    nextCursor: truncated ? offsetLine + selected.length : null,
  };
}

async function readManyAction(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!Array.isArray(input.paths))
    throw new Error("INVALID_INPUT: paths must be an array");
  const paths = input.paths
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 100);
  const maxChars = Math.max(
    1_000,
    Math.min(Math.floor(numberInput(input, "maxChars", 100_000)), 1_000_000),
  );
  const files: Array<Record<string, unknown>> = [];
  let used = 0;
  let omitted = 0;
  for (const value of paths) {
    try {
      const target = context.workspace.resolve(value);
      const content = await readFile(target, "utf8");
      const remaining = maxChars - used;
      if (remaining <= 0) {
        omitted += 1;
        continue;
      }
      const text = content.slice(0, remaining);
      used += text.length;
      files.push({
        path: target,
        content: text,
        sha256: await hashFile(target),
        truncated: text.length < content.length,
      });
      if (text.length < content.length) omitted += 1;
    } catch (error) {
      files.push({
        path: context.workspace.resolve(value),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    summary: `Read ${files.length} file(s)`,
    data: {
      files,
      requested: paths.length,
      omitted,
      totalChars: used,
      maxChars,
      truncated: omitted > 0,
    },
    truncated: omitted > 0,
    nextCursor: null,
  };
}

async function writeFileAction(
  context: ToolContext,
  input: Record<string, unknown>,
  action: "write" | "append",
): Promise<Record<string, unknown>> {
  const target = context.workspace.resolve(stringInput(input, "path", true)!);
  const expected = stringInput(input, "expectedSha256");
  await checkExpected(target, expected);
  const encoding =
    stringInput(input, "encoding") ??
    (input.contentBase64 !== undefined ? "base64" : "utf8");
  const content =
    encoding === "base64"
      ? Buffer.from(stringInput(input, "contentBase64", true)!, "base64")
      : Buffer.from(stringInput(input, "content", true)!, "utf8");
  await mkdir(path.dirname(target), { recursive: true });
  if (action === "append") {
    const existing = await readFile(target).catch(() => Buffer.alloc(0));
    await writeAtomicFile(target, Buffer.concat([existing, content]));
  } else await writeAtomicFile(target, content);
  const changed = await changedFile(target, action);
  await recordFileChange(
    context,
    `${action === "write" ? "Wrote" : "Appended"} ${target}`,
    [target],
  );
  return {
    summary: `${action === "write" ? "Wrote" : "Appended"} ${changed.bytes} bytes to ${target}`,
    data: { changed: [changed] },
  };
}

async function replaceFileAction(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const target = context.workspace.resolve(stringInput(input, "path", true)!);
  await checkExpected(target, stringInput(input, "expectedSha256"));
  const oldText = stringInput(input, "oldText", true)!;
  const newText = stringInput(input, "newText", true)!;
  const replaceAll = booleanInput(input, "replaceAll", false);
  const current = await readFile(target, "utf8");
  const occurrences = current.split(oldText).length - 1;
  if (occurrences === 0)
    throw new Error(`TEXT_NOT_FOUND: No matching oldText in ${target}`);
  const next = replaceAll
    ? current.split(oldText).join(newText)
    : current.replace(oldText, newText);
  await writeAtomicFile(target, next);
  const changed = await changedFile(target, "replace");
  await recordFileChange(context, `Replaced text in ${target}`, [target]);
  return {
    summary: `Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${target}`,
    data: { changed: [changed], occurrences },
  };
}

async function multiEditAction(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!Array.isArray(input.edits))
    throw new Error("INVALID_INPUT: edits must be an array");
  const changed: ChangedFile[] = [];
  for (const raw of input.edits) {
    if (!raw || typeof raw !== "object")
      throw new Error("INVALID_INPUT: each edit must be an object");
    const edit = raw as Record<string, unknown>;
    const target = context.workspace.resolve(stringInput(edit, "path", true)!);
    await checkExpected(target, stringInput(edit, "expectedSha256"));
    const current = await readFile(target, "utf8");
    const oldText = stringInput(edit, "oldText", true)!;
    const newText = stringInput(edit, "newText", true)!;
    const replaceAll = booleanInput(edit, "replaceAll", false);
    if (!current.includes(oldText))
      throw new Error(`TEXT_NOT_FOUND: No matching oldText in ${target}`);
    const next = replaceAll
      ? current.split(oldText).join(newText)
      : current.replace(oldText, newText);
    await writeAtomicFile(target, next);
    changed.push(await changedFile(target, "multi_edit"));
  }
  await recordFileChange(
    context,
    `Edited ${changed.length} file(s)`,
    changed.map((entry) => entry.path),
  );
  return { summary: `Edited ${changed.length} file(s)`, data: { changed } };
}

async function applyPatchAction(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const patch = stringInput(input, "patch", true)!;
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const changed: ChangedFile[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
    const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
    const deleteMatch = line.match(/^\*\*\* Delete File: (.+)$/);
    if (addMatch) {
      const target = context.workspace.resolve(addMatch[1]!);
      index += 1;
      const additions: string[] = [];
      while (index < lines.length && !lines[index]!.startsWith("*** ")) {
        const current = lines[index]!;
        if (current.startsWith("+")) additions.push(current.slice(1));
        else if (current !== "") additions.push(current);
        index += 1;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeAtomicFile(
        target,
        `${additions.join("\n")}${additions.length ? "\n" : ""}`,
      );
      changed.push(await changedFile(target, "apply_patch:add"));
      continue;
    }
    if (deleteMatch) {
      const target = context.workspace.resolve(deleteMatch[1]!);
      await rm(target, { force: false, recursive: true });
      changed.push({
        path: target,
        operation: "apply_patch:delete",
        bytes: 0,
        sha256: "deleted",
      });
      index += 1;
      continue;
    }
    if (updateMatch) {
      const target = context.workspace.resolve(updateMatch[1]!);
      const current = await readFile(target, "utf8");
      const patchLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("*** ")) {
        patchLines.push(lines[index]!);
        index += 1;
      }
      const next = applyUnifiedFilePatch(current, patchLines);
      await writeAtomicFile(target, next);
      changed.push(await changedFile(target, "apply_patch:update"));
      continue;
    }
    index += 1;
  }
  if (changed.length === 0)
    throw new Error("INVALID_PATCH: No Add/Update/Delete file sections found");
  await recordFileChange(
    context,
    `Applied patch to ${changed.length} file(s)`,
    changed.map((entry) => entry.path),
  );
  return {
    summary: `Applied patch to ${changed.length} file(s)`,
    data: { changed },
  };
}

async function recordFileChange(
  context: ToolContext,
  summary: string,
  paths: string[],
): Promise<void> {
  try {
    await context.memory?.recordChange({ source: "files", summary, paths });
  } catch {
    // A memory metadata failure must not make an already completed filesystem
    // mutation look like it failed.
  }
}

function applyUnifiedFilePatch(current: string, patchLines: string[]): string {
  const original = current.split(/\r?\n/);
  if (original.at(-1) === "") original.pop();
  const output: string[] = [];
  let sourceIndex = 0;
  let index = 0;
  while (index < patchLines.length) {
    const header = patchLines[index]!.match(
      /^@@ -([0-9]+)(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@/,
    );
    if (!header) {
      index += 1;
      continue;
    }
    const start = Math.max(0, Number(header[1]) - 1);
    while (sourceIndex < start) output.push(original[sourceIndex++]!);
    index += 1;
    while (index < patchLines.length && !patchLines[index]!.startsWith("@@ ")) {
      const line = patchLines[index]!;
      if (line.startsWith(" ")) {
        const expected = line.slice(1);
        if (original[sourceIndex] !== expected)
          throw new Error(
            `PATCH_CONTEXT_MISMATCH: expected '${expected}' at line ${sourceIndex + 1}`,
          );
        output.push(original[sourceIndex++]!);
      } else if (line.startsWith("-")) {
        const expected = line.slice(1);
        if (original[sourceIndex] !== expected)
          throw new Error(
            `PATCH_DELETE_MISMATCH: expected '${expected}' at line ${sourceIndex + 1}`,
          );
        sourceIndex += 1;
      } else if (line.startsWith("+")) output.push(line.slice(1));
      index += 1;
    }
  }
  while (sourceIndex < original.length) output.push(original[sourceIndex++]!);
  return `${output.join("\n")}${output.length ? "\n" : ""}`;
}

async function checkExpected(target: string, expected?: string): Promise<void> {
  if (!expected) return;
  const actual = await hashFile(target);
  if (actual.toLowerCase() !== expected.toLowerCase())
    throw new Error(
      `REVISION_MISMATCH: ${target} has sha256 ${actual}, expected ${expected}`,
    );
}

async function hashFile(target: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(target));
  return hash.digest("hex");
}

async function changedFile(
  target: string,
  operation: string,
): Promise<ChangedFile> {
  const bytes = (await stat(target)).size;
  return { path: target, operation, bytes, sha256: await hashFile(target) };
}

async function writeAtomicFile(
  target: string,
  content: string | Uint8Array,
): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
