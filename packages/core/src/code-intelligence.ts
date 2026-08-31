import { statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type CodeDiagnosticSeverity =
  "error" | "warning" | "suggestion" | "message";

export interface CodeDiagnostic {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: CodeDiagnosticSeverity;
  source: "typescript";
  code: string;
  message: string;
}

export interface CodeLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  preview: string;
}

export interface CodeSymbol extends CodeLocation {
  name: string;
  kind: string;
  container: string | null;
}

export interface HoverResult extends CodeLocation {
  kind: string;
  display: string;
  documentation: string;
}

export interface DiagnosticsInput {
  workspaceRoot: string;
  path?: string;
  tsconfig?: string;
  severity?: CodeDiagnosticSeverity;
  maxResults?: number;
  offset?: number;
}

export interface DiagnosticsResult {
  tsconfigs: string[];
  diagnostics: CodeDiagnostic[];
  total: number;
  offset: number;
  maxResults: number;
  truncated: boolean;
  nextOffset: number | null;
}

export interface FileIntelligenceInput {
  workspaceRoot: string;
  path: string;
  tsconfig?: string;
  maxResults?: number;
  offset?: number;
}

export interface PositionIntelligenceInput extends FileIntelligenceInput {
  line: number;
  column: number;
}

export interface WorkspaceSymbolsInput {
  workspaceRoot: string;
  query: string;
  tsconfig?: string;
  maxResults?: number;
  offset?: number;
}

export interface SymbolsResult {
  symbols: CodeSymbol[];
  total: number;
  offset: number;
  maxResults: number;
  truncated: boolean;
  nextOffset: number | null;
}

export interface LocationsResult {
  locations: CodeLocation[];
  total: number;
  offset: number;
  maxResults: number;
  truncated: boolean;
  nextOffset: number | null;
}

export interface CodeIntelligenceService {
  diagnostics(input: DiagnosticsInput): Promise<DiagnosticsResult>;
  documentSymbols(input: FileIntelligenceInput): Promise<SymbolsResult>;
  workspaceSymbols(input: WorkspaceSymbolsInput): Promise<SymbolsResult>;
  definition(input: PositionIntelligenceInput): Promise<LocationsResult>;
  references(input: PositionIntelligenceInput): Promise<LocationsResult>;
  hover(input: PositionIntelligenceInput): Promise<HoverResult | null>;
  renameLocations(input: PositionIntelligenceInput): Promise<LocationsResult>;
}

interface ProjectCacheEntry {
  fingerprint: string;
  diagnostics: readonly ts.Diagnostic[];
}

interface LanguageServiceCacheEntry {
  fingerprint: string;
  project: LanguageProject;
}

interface ParsedProject {
  configPath: string;
  parsed: ts.ParsedCommandLine;
  diagnostics: ts.Diagnostic[];
}

interface LanguageProject {
  configPath: string;
  parsed: ts.ParsedCommandLine;
  service: ts.LanguageService;
}

const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS = 2_000;

export class TypeScriptCodeIntelligence implements CodeIntelligenceService {
  private readonly diagnosticCache = new Map<string, ProjectCacheEntry>();
  private readonly languageServiceCache = new Map<
    string,
    LanguageServiceCacheEntry
  >();

  public async diagnostics(
    input: DiagnosticsInput,
  ): Promise<DiagnosticsResult> {
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const target = resolveTargetPath(workspaceRoot, input.path);
    const configPath = resolveTsconfigPath(
      workspaceRoot,
      target,
      input.tsconfig,
    );
    const projects = collectProjectGraph(configPath);
    const targetInfo = safeStat(target);
    const severity = input.severity;
    const { maxResults, offset } = pagination(input);

    const diagnostics: CodeDiagnostic[] = [];
    const seen = new Set<string>();
    for (const project of projects) {
      const projectDiagnostics = this.projectDiagnostics(project);
      for (const diagnostic of projectDiagnostics) {
        const converted = convertDiagnostic(
          diagnostic,
          project.configPath,
          workspaceRoot,
        );
        if (severity && converted.severity !== severity) continue;
        if (
          !diagnosticMatchesTarget(
            diagnostic,
            project.configPath,
            target,
            targetInfo,
          )
        )
          continue;
        const key = [
          comparablePath(converted.file),
          converted.line,
          converted.column,
          converted.code,
          converted.message,
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        diagnostics.push(converted);
      }
    }

    diagnostics.sort(compareDiagnostics);
    const page = paginate(diagnostics, offset, maxResults);
    return {
      tsconfigs: projects.map((project) =>
        displayPath(project.configPath, workspaceRoot),
      ),
      diagnostics: page.items,
      total: diagnostics.length,
      offset,
      maxResults,
      truncated: page.truncated,
      nextOffset: page.nextOffset,
    };
  }

  public async documentSymbols(
    input: FileIntelligenceInput,
  ): Promise<SymbolsResult> {
    const prepared = this.prepareFile(input);
    const { maxResults, offset } = pagination(input);
    const tree = prepared.project.service.getNavigationTree(prepared.file);
    const symbols: CodeSymbol[] = [];
    collectNavigationSymbols(
      tree.childItems ?? [],
      null,
      prepared.workspaceRoot,
      prepared.file,
      symbols,
    );
    const page = paginate(symbols, offset, maxResults);
    return {
      symbols: page.items,
      total: symbols.length,
      offset,
      maxResults,
      truncated: page.truncated,
      nextOffset: page.nextOffset,
    };
  }

  public async workspaceSymbols(
    input: WorkspaceSymbolsInput,
  ): Promise<SymbolsResult> {
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const query = input.query.trim();
    if (!query)
      throw new Error("INVALID_INPUT: workspace symbol query is required");
    const configPath = resolveTsconfigPath(
      workspaceRoot,
      workspaceRoot,
      input.tsconfig,
    );
    const projects = collectProjectGraph(configPath);
    const symbols: CodeSymbol[] = [];
    const seen = new Set<string>();
    for (const parsedProject of projects) {
      const project = this.languageProject(parsedProject.configPath);
      const items = project.service.getNavigateToItems(query) ?? [];
      for (const item of items) {
        const location = locationFromSpan(
          item.fileName,
          item.textSpan,
          workspaceRoot,
        );
        const key = `${comparablePath(item.fileName)}:${location.line}:${location.column}:${item.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        symbols.push({
          name: item.name,
          kind: item.kind,
          container: item.containerName || null,
          ...location,
        });
      }
    }
    symbols.sort(
      (left, right) =>
        left.name.localeCompare(right.name) || compareLocations(left, right),
    );
    const { maxResults, offset } = pagination(input);
    const page = paginate(symbols, offset, maxResults);
    return {
      symbols: page.items,
      total: symbols.length,
      offset,
      maxResults,
      truncated: page.truncated,
      nextOffset: page.nextOffset,
    };
  }

  public async definition(
    input: PositionIntelligenceInput,
  ): Promise<LocationsResult> {
    const prepared = this.preparePosition(input);
    const definitions =
      prepared.project.service.getDefinitionAtPosition(
        prepared.file,
        prepared.position,
      ) ?? [];
    return locationsResult(
      dedupeLocations(
        definitions.map((entry) =>
          locationFromSpan(
            entry.fileName,
            entry.textSpan,
            prepared.workspaceRoot,
          ),
        ),
      ),
      input,
    );
  }

  public async references(
    input: PositionIntelligenceInput,
  ): Promise<LocationsResult> {
    const prepared = this.preparePosition(input);
    const groups =
      prepared.project.service.findReferences(
        prepared.file,
        prepared.position,
      ) ?? [];
    const locations = groups.flatMap((group) =>
      group.references.map((reference) =>
        locationFromSpan(
          reference.fileName,
          reference.textSpan,
          prepared.workspaceRoot,
        ),
      ),
    );
    return locationsResult(dedupeLocations(locations), input);
  }

  public async hover(
    input: PositionIntelligenceInput,
  ): Promise<HoverResult | null> {
    const prepared = this.preparePosition(input);
    const info = prepared.project.service.getQuickInfoAtPosition(
      prepared.file,
      prepared.position,
    );
    if (!info) return null;
    return {
      ...locationFromSpan(prepared.file, info.textSpan, prepared.workspaceRoot),
      kind: info.kind,
      display: ts.displayPartsToString(info.displayParts),
      documentation: [
        ts.displayPartsToString(info.documentation),
        ...(info.tags ?? []).map((tag) =>
          `@${tag.name} ${ts.displayPartsToString(tag.text)}`.trim(),
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  public async renameLocations(
    input: PositionIntelligenceInput,
  ): Promise<LocationsResult> {
    const prepared = this.preparePosition(input);
    const renameInfo = prepared.project.service.getRenameInfo(
      prepared.file,
      prepared.position,
      { allowRenameOfImportPath: false },
    );
    if (!renameInfo.canRename)
      throw new Error(
        `RENAME_NOT_AVAILABLE: ${renameInfo.localizedErrorMessage}`,
      );
    const locations =
      prepared.project.service.findRenameLocations(
        prepared.file,
        prepared.position,
        false,
        false,
        { allowRenameOfImportPath: false },
      ) ?? [];
    return locationsResult(
      dedupeLocations(
        locations.map((entry) =>
          locationFromSpan(
            entry.fileName,
            entry.textSpan,
            prepared.workspaceRoot,
          ),
        ),
      ),
      input,
    );
  }

  private prepareFile(input: FileIntelligenceInput): {
    workspaceRoot: string;
    file: string;
    project: LanguageProject;
  } {
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const file = resolveTargetPath(workspaceRoot, input.path);
    if (!safeStat(file)?.isFile())
      throw new Error(
        `INVALID_INPUT: path must point to a source file: ${file}`,
      );
    const configPath = resolveTsconfigPath(workspaceRoot, file, input.tsconfig);
    const project = this.languageProject(configPath);
    if (!project.parsed.fileNames.some((entry) => samePath(entry, file)))
      throw new Error(
        `PROJECT_FILE_NOT_INCLUDED: ${file} is not included by ${configPath}`,
      );
    return { workspaceRoot, file, project };
  }

  private preparePosition(input: PositionIntelligenceInput): {
    workspaceRoot: string;
    file: string;
    project: LanguageProject;
    position: number;
  } {
    const prepared = this.prepareFile(input);
    const sourceFile = prepared.project.service
      .getProgram()
      ?.getSourceFile(prepared.file);
    const text = sourceFile?.text ?? ts.sys.readFile(prepared.file);
    if (text === undefined)
      throw new Error(`ENOENT: Unable to read source file ${prepared.file}`);
    const position = positionFromLineColumn(
      text,
      input.line,
      input.column,
      prepared.file,
    );
    return { ...prepared, position };
  }

  private projectDiagnostics(project: ParsedProject): readonly ts.Diagnostic[] {
    const fingerprint = projectFingerprint(project);
    const cached = this.diagnosticCache.get(project.configPath);
    if (cached?.fingerprint === fingerprint) return cached.diagnostics;

    const diagnostics: ts.Diagnostic[] = [...project.diagnostics];
    if (project.parsed.fileNames.length > 0) {
      const options = runtimeCompilerOptions({
        ...project.parsed.options,
        noEmit: true,
      });
      const host = ts.createCompilerHost(options);
      host.getDefaultLibFileName = runtimeDefaultLibFile;
      const program = ts.createProgram({
        rootNames: project.parsed.fileNames,
        options,
        host,
        projectReferences: project.parsed.projectReferences,
      });
      diagnostics.push(...ts.getPreEmitDiagnostics(program));
    }
    this.diagnosticCache.set(project.configPath, { fingerprint, diagnostics });
    return diagnostics;
  }

  private languageProject(configPath: string): LanguageProject {
    const parsedProject = parseProject(configPath);
    const errors = parsedProject.diagnostics.filter(
      (entry) => entry.category === ts.DiagnosticCategory.Error,
    );
    if (errors.length > 0) {
      const first = convertDiagnostic(
        errors[0]!,
        configPath,
        path.dirname(configPath),
      );
      throw new Error(
        `TSCONFIG_INVALID: ${first.code} ${first.file}:${first.line}:${first.column} ${first.message}`,
      );
    }
    const fingerprint = projectFingerprint(parsedProject);
    const cached = this.languageServiceCache.get(parsedProject.configPath);
    if (cached?.fingerprint === fingerprint) return cached.project;

    const options = runtimeCompilerOptions(parsedProject.parsed.options);
    const versions = new Map(
      parsedProject.parsed.fileNames.map((file) => [
        comparablePath(file),
        fingerprintPath(file),
      ]),
    );
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => parsedProject.parsed.fileNames,
      getScriptVersion: (fileName) =>
        versions.get(comparablePath(fileName)) ?? "0",
      getScriptSnapshot: (fileName) => {
        const text = ts.sys.readFile(fileName);
        return text === undefined
          ? undefined
          : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => path.dirname(parsedProject.configPath),
      getDefaultLibFileName: runtimeDefaultLibFile,
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => ts.sys.newLine,
      getProjectReferences: () => parsedProject.parsed.projectReferences,
    };
    const project: LanguageProject = {
      configPath: parsedProject.configPath,
      parsed: parsedProject.parsed,
      service: ts.createLanguageService(
        host,
        ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames),
      ),
    };
    this.languageServiceCache.set(parsedProject.configPath, {
      fingerprint,
      project,
    });
    return project;
  }
}

function runtimeCompilerOptions(
  options: ts.CompilerOptions,
): ts.CompilerOptions {
  const libDirectory = runtimeTypeScriptLibDirectory();
  const defaultDirectory = path.dirname(ts.getDefaultLibFilePath(options));
  if (samePath(libDirectory, defaultDirectory)) return options;
  return {
    ...options,
    ...(options.lib
      ? {
          lib: options.lib.map((entry) =>
            path.isAbsolute(entry)
              ? entry
              : path.join(libDirectory, path.basename(entry)),
          ),
        }
      : {}),
  };
}

function runtimeDefaultLibFile(options: ts.CompilerOptions): string {
  const original = ts.getDefaultLibFilePath(options);
  const candidate = path.join(
    runtimeTypeScriptLibDirectory(),
    path.basename(original),
  );
  return safeStat(candidate)?.isFile() ? candidate : original;
}

function runtimeTypeScriptLibDirectory(): string {
  const defaultDirectory = path.dirname(
    ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 }),
  );
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const candidates = [
    process.env.QNECTOR_TYPESCRIPT_LIB_PATH?.trim(),
    resourcesPath ? path.join(resourcesPath, "typescript-lib") : undefined,
    defaultDirectory,
  ];
  return (
    candidates.find(
      (candidate): candidate is string =>
        Boolean(candidate) &&
        safeStat(path.join(candidate!, "lib.d.ts"))?.isFile() === true,
    ) ?? defaultDirectory
  );
}

function resolveTargetPath(workspaceRoot: string, value?: string): string {
  const target = value
    ? path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(workspaceRoot, value)
    : workspaceRoot;
  if (!safeStat(target)) throw new Error(`ENOENT: ${target}`);
  return target;
}

function resolveTsconfigPath(
  workspaceRoot: string,
  target: string,
  explicit?: string,
): string {
  if (explicit) {
    const resolved = path.isAbsolute(explicit)
      ? path.resolve(explicit)
      : path.resolve(workspaceRoot, explicit);
    const info = safeStat(resolved);
    if (!info?.isFile())
      throw new Error(
        `TSCONFIG_NOT_FOUND: TypeScript config not found at ${resolved}`,
      );
    return resolved;
  }

  const targetInfo = safeStat(target);
  let current = targetInfo?.isDirectory() ? target : path.dirname(target);
  while (true) {
    const candidate = path.join(current, "tsconfig.json");
    if (safeStat(candidate)?.isFile()) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    `TSCONFIG_NOT_FOUND: No tsconfig.json found from ${target}. Pass tsconfig explicitly if the project uses a non-standard config name.`,
  );
}

function collectProjectGraph(rootConfigPath: string): ParsedProject[] {
  const queue = [path.resolve(rootConfigPath)];
  const visited = new Set<string>();
  const projects: ParsedProject[] = [];
  while (queue.length > 0) {
    const configPath = queue.shift()!;
    const key = comparablePath(configPath);
    if (visited.has(key)) continue;
    visited.add(key);
    const project = parseProject(configPath);
    projects.push(project);
    for (const reference of project.parsed.projectReferences ?? []) {
      queue.push(resolveProjectReference(reference.path));
    }
  }
  return projects;
}

function parseProject(configPath: string): ParsedProject {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const diagnostics: ts.Diagnostic[] = [];
  if (read.error) diagnostics.push(read.error);
  const parsed = ts.parseJsonConfigFileContent(
    read.config ?? {},
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  diagnostics.push(...parsed.errors);
  return { configPath: path.resolve(configPath), parsed, diagnostics };
}

function resolveProjectReference(referencePath: string): string {
  const resolved = path.resolve(referencePath);
  const info = safeStat(resolved);
  if (info?.isDirectory()) return path.join(resolved, "tsconfig.json");
  if (info?.isFile()) return resolved;
  if (path.extname(resolved).toLowerCase() === ".json") return resolved;
  return path.join(resolved, "tsconfig.json");
}

function projectFingerprint(project: ParsedProject): string {
  const entries = [
    fingerprintPath(project.configPath),
    ...project.parsed.fileNames.map(fingerprintPath),
  ];
  return entries.join("|");
}

function fingerprintPath(file: string): string {
  try {
    const info = statSync(file);
    return `${comparablePath(file)}:${info.mtimeMs}:${info.size}`;
  } catch {
    return `${comparablePath(file)}:missing`;
  }
}

function convertDiagnostic(
  diagnostic: ts.Diagnostic,
  configPath: string,
  workspaceRoot: string,
): CodeDiagnostic {
  const sourceFile = diagnostic.file;
  const file = sourceFile?.fileName ?? configPath;
  const start = diagnostic.start ?? 0;
  const length = diagnostic.length ?? 0;
  const startLocation = sourceFile
    ? sourceFile.getLineAndCharacterOfPosition(
        Math.max(0, Math.min(start, sourceFile.text.length)),
      )
    : { line: 0, character: 0 };
  const endPosition = start + length;
  const endLocation = sourceFile
    ? sourceFile.getLineAndCharacterOfPosition(
        Math.max(0, Math.min(endPosition, sourceFile.text.length)),
      )
    : startLocation;
  return {
    file: displayPath(file, workspaceRoot),
    line: startLocation.line + 1,
    column: startLocation.character + 1,
    endLine: endLocation.line + 1,
    endColumn: endLocation.character + 1,
    severity: diagnosticSeverity(diagnostic.category),
    source: "typescript",
    code: `TS${diagnostic.code}`,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
}

function diagnosticSeverity(
  category: ts.DiagnosticCategory,
): CodeDiagnosticSeverity {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warning";
  if (category === ts.DiagnosticCategory.Suggestion) return "suggestion";
  return "message";
}

function diagnosticMatchesTarget(
  diagnostic: ts.Diagnostic,
  configPath: string,
  target: string,
  targetInfo: ReturnType<typeof safeStat>,
): boolean {
  const diagnosticPath = path.resolve(diagnostic.file?.fileName ?? configPath);
  if (targetInfo?.isFile()) return samePath(diagnosticPath, target);
  const relative = path.relative(target, diagnosticPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function collectNavigationSymbols(
  items: readonly ts.NavigationTree[],
  container: string | null,
  workspaceRoot: string,
  file: string,
  output: CodeSymbol[],
): void {
  for (const item of items) {
    const span = item.spans[0];
    if (!span) continue;
    output.push({
      name: item.text,
      kind: item.kind,
      container,
      ...locationFromSpan(file, span, workspaceRoot),
    });
    collectNavigationSymbols(
      item.childItems ?? [],
      item.text,
      workspaceRoot,
      file,
      output,
    );
  }
}

function locationFromSpan(
  file: string,
  span: ts.TextSpan,
  workspaceRoot: string,
): CodeLocation {
  const text = ts.sys.readFile(file) ?? "";
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const start = Math.max(0, Math.min(span.start, text.length));
  const end = Math.max(start, Math.min(span.start + span.length, text.length));
  const startLocation = source.getLineAndCharacterOfPosition(start);
  const endLocation = source.getLineAndCharacterOfPosition(end);
  const lineText = text.split(/\r?\n/)[startLocation.line] ?? "";
  return {
    file: displayPath(file, workspaceRoot),
    line: startLocation.line + 1,
    column: startLocation.character + 1,
    endLine: endLocation.line + 1,
    endColumn: endLocation.character + 1,
    preview: lineText.trim().slice(0, 400),
  };
}

function positionFromLineColumn(
  text: string,
  line: number,
  column: number,
  file: string,
): number {
  if (
    !Number.isInteger(line) ||
    line < 1 ||
    !Number.isInteger(column) ||
    column < 1
  )
    throw new Error(
      `INVALID_POSITION: line and column must be positive 1-based integers for ${file}`,
    );
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const starts = source.getLineStarts();
  if (line > starts.length)
    throw new Error(
      `INVALID_POSITION: line ${line} is outside ${file} (${starts.length} line(s))`,
    );
  const start = starts[line - 1]!;
  const nextStart = line < starts.length ? starts[line]! : text.length;
  const rawLine = text.slice(start, nextStart).replace(/\r?\n$/, "");
  if (column > rawLine.length + 1)
    throw new Error(
      `INVALID_POSITION: column ${column} is outside line ${line} of ${file} (max ${rawLine.length + 1})`,
    );
  return start + column - 1;
}

function locationsResult(
  locations: CodeLocation[],
  input: Pick<FileIntelligenceInput, "maxResults" | "offset">,
): LocationsResult {
  locations.sort(compareLocations);
  const { maxResults, offset } = pagination(input);
  const page = paginate(locations, offset, maxResults);
  return {
    locations: page.items,
    total: locations.length,
    offset,
    maxResults,
    truncated: page.truncated,
    nextOffset: page.nextOffset,
  };
}

function dedupeLocations(locations: CodeLocation[]): CodeLocation[] {
  const seen = new Set<string>();
  return locations.filter((entry) => {
    const key = `${comparablePath(entry.file)}:${entry.line}:${entry.column}:${entry.endLine}:${entry.endColumn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pagination(input: { maxResults?: number; offset?: number }): {
  maxResults: number;
  offset: number;
} {
  return {
    maxResults: Math.max(
      1,
      Math.min(input.maxResults ?? DEFAULT_MAX_RESULTS, MAX_RESULTS),
    ),
    offset: Math.max(0, input.offset ?? 0),
  };
}

function paginate<T>(
  entries: T[],
  offset: number,
  maxResults: number,
): { items: T[]; truncated: boolean; nextOffset: number | null } {
  const items = entries.slice(offset, offset + maxResults);
  const truncated = offset + items.length < entries.length;
  return {
    items,
    truncated,
    nextOffset: truncated ? offset + items.length : null,
  };
}

function displayPath(file: string, workspaceRoot: string): string {
  const resolved = path.resolve(file);
  const relative = path.relative(workspaceRoot, resolved);
  const value =
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
      ? relative || path.basename(resolved)
      : resolved;
  return value.replaceAll("\\", "/");
}

function safeStat(value: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(value);
  } catch {
    return undefined;
  }
}

function comparablePath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function compareDiagnostics(
  left: CodeDiagnostic,
  right: CodeDiagnostic,
): number {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function compareLocations(left: CodeLocation, right: CodeLocation): number {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.endLine - right.endLine ||
    left.endColumn - right.endColumn
  );
}
