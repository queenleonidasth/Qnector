import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type UiAutomationControlType = string;
export type UiAutomationWaitCondition =
  "exists" | "not_exists" | "enabled" | "disabled" | "value_equals";

export interface UiAutomationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UiAutomationWindow {
  windowId: string;
  name: string;
  automationId: string;
  controlType: UiAutomationControlType;
  className: string;
  processId: number;
  enabled: boolean;
  offscreen: boolean;
  bounds?: UiAutomationBounds;
}

export interface UiAutomationElement {
  elementId: string;
  parentElementId?: string;
  depth?: number;
  name: string;
  automationId: string;
  controlType: UiAutomationControlType;
  className: string;
  processId: number;
  enabled: boolean;
  offscreen: boolean;
  focusable: boolean;
  value?: string;
  patterns?: string[];
  bounds?: UiAutomationBounds;
}

export interface UiAutomationFindInput {
  windowId: string;
  name?: string;
  automationId?: string;
  controlType?: string;
  className?: string;
  maxResults?: number;
}

export interface UiAutomationInspectInput {
  windowId: string;
  depth?: number;
  maxResults?: number;
}

export interface UiAutomationWaitInput extends Omit<
  UiAutomationFindInput,
  "maxResults"
> {
  condition?: UiAutomationWaitCondition;
  value?: string;
  timeoutMs?: number;
}

export interface UiAutomationService {
  windows(maxResults?: number): Promise<UiAutomationWindow[]>;
  inspect(input: UiAutomationInspectInput): Promise<UiAutomationElement[]>;
  find(input: UiAutomationFindInput): Promise<UiAutomationElement[]>;
  invoke(elementId: string): Promise<UiAutomationElement>;
  setValue(elementId: string, value: string): Promise<UiAutomationElement>;
  focus(elementId: string): Promise<UiAutomationElement>;
  select(elementId: string): Promise<UiAutomationElement>;
  toggle(elementId: string): Promise<UiAutomationElement>;
  expand(elementId: string): Promise<UiAutomationElement>;
  collapse(elementId: string): Promise<UiAutomationElement>;
  scrollIntoView(elementId: string): Promise<UiAutomationElement>;
  setRangeValue(elementId: string, value: number): Promise<UiAutomationElement>;
  wait(input: UiAutomationWaitInput): Promise<{
    condition: UiAutomationWaitCondition;
    matched: boolean;
    elapsedMs: number;
    element?: UiAutomationElement;
  }>;
}

interface RawElement {
  RuntimeId: string;
  ParentRuntimeId?: string;
  Depth?: number;
  Name?: string;
  AutomationId?: string;
  ControlType?: string;
  ClassName?: string;
  ProcessId?: number;
  Enabled?: boolean;
  Offscreen?: boolean;
  Focusable?: boolean;
  Value?: string;
  Patterns?: string[];
  X?: number;
  Y?: number;
  Width?: number;
  Height?: number;
}

interface ElementLocator {
  processId: number;
  runtimeId: string;
  windowRuntimeId: string;
}

interface WindowLocator {
  processId: number;
  runtimeId: string;
}

export interface WindowsUiAutomationOptions {
  powershellPath?: string;
  helperPath?: string;
  platform?: NodeJS.Platform;
  runPowerShell?: (script: string) => Promise<string>;
}

export class WindowsUiAutomationService implements UiAutomationService {
  private readonly powershellPath?: string;
  private readonly helperPath?: string;
  private readonly platform: NodeJS.Platform;
  private readonly runOverride?: (script: string) => Promise<string>;
  private readonly windowsById = new Map<string, WindowLocator>();
  private readonly elementsById = new Map<string, ElementLocator>();

  public constructor(options: WindowsUiAutomationOptions = {}) {
    this.powershellPath = options.powershellPath;
    this.helperPath = resolveUiAutomationHelper(options.helperPath);
    this.platform = options.platform ?? process.platform;
    this.runOverride = options.runPowerShell;
  }

  public async windows(maxResults = 100): Promise<UiAutomationWindow[]> {
    this.requireWindows();
    const limit = clampInt(maxResults, 1, 500);
    const raw = await this.run("windows", { maxResults: limit });
    const rows = asRawElements(raw);
    const results: UiAutomationWindow[] = [];
    for (const row of rows) {
      if (!row.RuntimeId || !Number.isInteger(row.ProcessId)) continue;
      const windowId = `uiaw_${randomUUID()}`;
      this.windowsById.set(windowId, {
        processId: row.ProcessId!,
        runtimeId: row.RuntimeId,
      });
      results.push({
        windowId,
        ...toWindow(row),
      });
    }
    pruneMap(this.windowsById, 2_000);
    return results;
  }

  public async inspect(
    input: UiAutomationInspectInput,
  ): Promise<UiAutomationElement[]> {
    const window = await this.resolveWindow(input.windowId);
    const depth = clampInt(input.depth ?? 4, 1, 12);
    const maxResults = clampInt(input.maxResults ?? 300, 1, 1_000);
    const raw = await this.run("inspect", {
      processId: window.processId,
      windowRuntimeId: window.runtimeId,
      depth,
      maxResults,
    });
    return this.storeElements(asRawElements(raw), window);
  }

  public async find(
    input: UiAutomationFindInput,
  ): Promise<UiAutomationElement[]> {
    const window = await this.resolveWindow(input.windowId);
    const maxResults = clampInt(input.maxResults ?? 50, 1, 500);
    const raw = await this.run("find", {
      processId: window.processId,
      windowRuntimeId: window.runtimeId,
      name: cleanFilter(input.name),
      automationId: cleanFilter(input.automationId),
      controlType: cleanFilter(input.controlType),
      className: cleanFilter(input.className),
      maxResults,
    });
    return this.storeElements(asRawElements(raw), window);
  }

  public invoke(elementId: string): Promise<UiAutomationElement> {
    return this.elementAction("invoke", elementId);
  }

  public setValue(
    elementId: string,
    value: string,
  ): Promise<UiAutomationElement> {
    if (value.length > 100_000)
      return Promise.reject(
        new Error(
          "INVALID_INPUT: UI Automation value exceeds 100000 characters",
        ),
      );
    return this.elementAction("set_value", elementId, { value });
  }

  public focus(elementId: string): Promise<UiAutomationElement> {
    return this.elementAction("focus", elementId);
  }

  public select(elementId: string): Promise<UiAutomationElement> {
    return this.elementAction("select", elementId);
  }

  public toggle(elementId: string): Promise<UiAutomationElement> {
    return this.elementAction("toggle", elementId);
  }

  public expand(elementId: string): Promise<UiAutomationElement> {
    return this.elementAction("expand", elementId);
  }

  public collapse(elementId: string): Promise<UiAutomationElement> {
    return this.elementAction("collapse", elementId);
  }

  public scrollIntoView(elementId: string): Promise<UiAutomationElement> {
    return this.elementAction("scroll_into_view", elementId);
  }

  public setRangeValue(
    elementId: string,
    value: number,
  ): Promise<UiAutomationElement> {
    if (!Number.isFinite(value))
      return Promise.reject(
        new Error("INVALID_INPUT: range value must be a number"),
      );
    return this.elementAction("range_value", elementId, { numberValue: value });
  }

  public async wait(input: UiAutomationWaitInput): Promise<{
    condition: UiAutomationWaitCondition;
    matched: boolean;
    elapsedMs: number;
    element?: UiAutomationElement;
  }> {
    const condition = input.condition ?? "exists";
    const timeoutMs = clampInt(input.timeoutMs ?? 30_000, 100, 120_000);
    if (condition === "value_equals" && input.value === undefined)
      throw new Error("INVALID_INPUT: value is required for value_equals wait");
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const matches = await this.find({ ...input, maxResults: 1 });
      const element = matches[0];
      const matched =
        condition === "not_exists"
          ? !element
          : condition === "exists"
            ? Boolean(element)
            : condition === "enabled"
              ? element?.enabled === true
              : condition === "disabled"
                ? element?.enabled === false
                : element?.value === input.value;
      if (matched)
        return {
          condition,
          matched: true,
          elapsedMs: Date.now() - startedAt,
          ...(element ? { element } : {}),
        };
      await delay(250);
    }
    throw new Error(
      `UIA_TIMEOUT: condition '${condition}' was not met within ${timeoutMs} ms`,
    );
  }

  private async elementAction(
    action:
      | "invoke"
      | "set_value"
      | "focus"
      | "select"
      | "toggle"
      | "expand"
      | "collapse"
      | "scroll_into_view"
      | "range_value",
    elementId: string,
    extra: Record<string, unknown> = {},
  ): Promise<UiAutomationElement> {
    const locator = this.elementsById.get(elementId);
    if (!locator)
      throw new Error(
        "ELEMENT_STALE: elementId is unknown or expired; call computer.find or computer.inspect again",
      );
    const raw = await this.run(action, {
      processId: locator.processId,
      windowRuntimeId: locator.windowRuntimeId,
      runtimeId: locator.runtimeId,
      ...extra,
    });
    const rows = asRawElements(raw);
    const row = rows[0];
    if (!row)
      throw new Error(
        "ELEMENT_STALE: UI element no longer exists; call computer.find or computer.inspect again",
      );
    return { elementId, ...toElement(row) };
  }

  private async resolveWindow(windowId: string): Promise<WindowLocator> {
    const stored = this.windowsById.get(windowId);
    if (stored) return stored;
    const legacy = /^window_(\d+)$/.exec(windowId);
    if (!legacy)
      throw new Error(
        `UIA_WINDOW_NOT_FOUND: unknown windowId '${windowId}'; call computer.windows first`,
      );
    const processId = Number(legacy[1]);
    const raw = await this.run("window_for_pid", { processId });
    const row = asRawElements(raw)[0];
    if (!row?.RuntimeId)
      throw new Error(
        `UIA_WINDOW_NOT_FOUND: no UI Automation window found for process ${processId}`,
      );
    return { processId, runtimeId: row.RuntimeId };
  }

  private storeElements(
    rows: RawElement[],
    window: WindowLocator,
  ): UiAutomationElement[] {
    const idByRuntime = new Map<string, string>();
    for (const row of rows) {
      if (!row.RuntimeId) continue;
      const id = `uia_${randomUUID()}`;
      idByRuntime.set(row.RuntimeId, id);
      this.elementsById.set(id, {
        processId: Number(row.ProcessId ?? window.processId),
        runtimeId: row.RuntimeId,
        windowRuntimeId: window.runtimeId,
      });
    }
    pruneMap(this.elementsById, 10_000);
    return rows.flatMap((row) => {
      if (!row.RuntimeId) return [];
      const elementId = idByRuntime.get(row.RuntimeId);
      if (!elementId) return [];
      return [
        {
          elementId,
          ...(row.ParentRuntimeId && idByRuntime.has(row.ParentRuntimeId)
            ? { parentElementId: idByRuntime.get(row.ParentRuntimeId)! }
            : {}),
          ...(Number.isInteger(row.Depth) ? { depth: row.Depth } : {}),
          ...toElement(row),
        },
      ];
    });
  }

  private async run(
    action: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    this.requireWindows();
    const payload = Buffer.from(JSON.stringify(input), "utf8").toString(
      "base64",
    );
    const script = buildPowerShellScript(action, payload);
    try {
      const stdout = this.runOverride
        ? await this.runOverride(script)
        : this.helperPath
          ? (
              await execFileAsync(this.helperPath, [action, payload], {
                windowsHide: true,
                maxBuffer: 8_000_000,
              })
            ).stdout
          : (
              await execFileAsync(
                this.powershellPath ??
                  process.env.QNECTOR_POWERSHELL_PATH ??
                  "powershell.exe",
                [
                  "-NoLogo",
                  "-NoProfile",
                  "-NonInteractive",
                  "-Command",
                  script,
                ],
                { windowsHide: true, maxBuffer: 8_000_000 },
              )
            ).stdout;
      const text = stdout.trim();
      if (!text) return [];
      return JSON.parse(text) as unknown;
    } catch (error: unknown) {
      const candidate = error as { stderr?: string; message?: string };
      const details = (
        candidate.stderr ??
        candidate.message ??
        String(error)
      ).trim();
      const cleaned = details.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
      const known = cleaned.match(
        /(ELEMENT_STALE|UIA_WINDOW_NOT_FOUND|UIA_ACTION_UNSUPPORTED|UIA_ACCESS_DENIED|UIA_TIMEOUT|INVALID_INPUT):\s*([^'\r\n}]*)/,
      );
      if (known) throw new Error(`${known[1]}: ${known[2]}`);
      throw new Error(`UIA_COMMAND_FAILED: ${details}`);
    }
  }

  private requireWindows(): void {
    if (this.platform !== "win32")
      throw new Error(
        "UNSUPPORTED_CAPABILITY: Windows UI Automation is available only on Windows",
      );
  }
}

function cleanFilter(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result.slice(0, 500) : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneMap<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const first = map.keys().next().value as string | undefined;
    if (!first) break;
    map.delete(first);
  }
}

function asRawElements(value: unknown): RawElement[] {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  return rows.filter(
    (row): row is RawElement => Boolean(row) && typeof row === "object",
  );
}

function toWindow(row: RawElement): Omit<UiAutomationWindow, "windowId"> {
  return {
    name: String(row.Name ?? ""),
    automationId: String(row.AutomationId ?? ""),
    controlType: normalizeControlType(row.ControlType),
    className: String(row.ClassName ?? ""),
    processId: Number(row.ProcessId ?? 0),
    enabled: row.Enabled !== false,
    offscreen: row.Offscreen === true,
    ...boundsFrom(row),
  };
}

function toElement(row: RawElement): Omit<UiAutomationElement, "elementId"> {
  return {
    name: String(row.Name ?? ""),
    automationId: String(row.AutomationId ?? ""),
    controlType: normalizeControlType(row.ControlType),
    className: String(row.ClassName ?? ""),
    processId: Number(row.ProcessId ?? 0),
    enabled: row.Enabled !== false,
    offscreen: row.Offscreen === true,
    focusable: row.Focusable === true,
    ...(typeof row.Value === "string" ? { value: row.Value } : {}),
    ...(Array.isArray(row.Patterns)
      ? {
          patterns: row.Patterns.filter(
            (entry) => typeof entry === "string",
          ).slice(0, 50),
        }
      : {}),
    ...boundsFrom(row),
  };
}

function normalizeControlType(value: string | undefined): string {
  return String(value ?? "Unknown").replace(/^ControlType\./, "");
}

function boundsFrom(row: RawElement): { bounds?: UiAutomationBounds } {
  if (
    !Number.isFinite(row.X) ||
    !Number.isFinite(row.Y) ||
    !Number.isFinite(row.Width) ||
    !Number.isFinite(row.Height)
  )
    return {};
  return {
    bounds: {
      x: Number(row.X),
      y: Number(row.Y),
      width: Number(row.Width),
      height: Number(row.Height),
    },
  };
}

function resolveUiAutomationHelper(explicit?: string): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const candidates = [
    explicit?.trim(),
    process.env.QNECTOR_UIA_HELPER_PATH?.trim(),
    resourcesPath
      ? path.join(resourcesPath, "uia-helper", "qnector-uia.exe")
      : undefined,
    path.join(
      process.cwd(),
      "tools",
      "uia-helper",
      "publish",
      "qnector-uia.exe",
    ),
    path.join(
      path.dirname(process.execPath),
      "resources",
      "uia-helper",
      "qnector-uia.exe",
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

function buildPowerShellScript(action: string, payloadBase64: string): string {
  const encodedAction = Buffer.from(action, "utf8").toString("base64");
  return String.raw`$ErrorActionPreference='Stop';
Add-Type -AssemblyName UIAutomationClient;
Add-Type -AssemblyName UIAutomationTypes;
$action=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedAction}'));
$inputJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payloadBase64}'));
$inputData=$inputJson | ConvertFrom-Json;
function Rid($e){ if($null -eq $e){return ''}; try { return (($e.GetRuntimeId()) -join '.') } catch { return '' } }
function ReadValue($e){ try { $p=$null; if($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){ return ([System.Windows.Automation.ValuePattern]$p).Current.Value } } catch {}; return $null }
function Row($e,$parentRid='',$depth=0){
  try { $r=$e.Current.BoundingRectangle; return [PSCustomObject]@{RuntimeId=(Rid $e);ParentRuntimeId=$parentRid;Depth=$depth;Name=$e.Current.Name;AutomationId=$e.Current.AutomationId;ControlType=$e.Current.ControlType.ProgrammaticName;ClassName=$e.Current.ClassName;ProcessId=$e.Current.ProcessId;Enabled=$e.Current.IsEnabled;Offscreen=$e.Current.IsOffscreen;Focusable=$e.Current.IsKeyboardFocusable;Value=(ReadValue $e);X=$r.X;Y=$r.Y;Width=$r.Width;Height=$r.Height} } catch { return $null }
}
function FindWindow($processId,$rid){
  $root=[System.Windows.Automation.AutomationElement]::RootElement;
  $all=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition);
  foreach($e in $all){ try { if($e.Current.ProcessId -eq $processId -and (($rid -eq '') -or ((Rid $e) -eq $rid))){ return $e } } catch {} }
  throw 'UIA_WINDOW_NOT_FOUND: target window is no longer available'
}
function FindElement($window,$rid){
  if((Rid $window) -eq $rid){ return $window }
  $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);
  foreach($e in $all){ if((Rid $e) -eq $rid){ return $e } }
  throw 'ELEMENT_STALE: UI element is no longer available'
}
function MatchText($actual,$expected,$contains=$false){ if([string]::IsNullOrWhiteSpace($expected)){return $true}; $text=if($null -eq $actual){''}else{[string]$actual}; if($contains){return $text.IndexOf($expected,[StringComparison]::OrdinalIgnoreCase) -ge 0}; return [string]::Equals($text,$expected,[StringComparison]::OrdinalIgnoreCase) }
function Walk($root,$maxDepth,$maxResults){
  $list=New-Object System.Collections.Generic.List[object]; $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker;
  function Visit($node,$parentRid,$depth){ if($depth -gt $maxDepth -or $list.Count -ge $maxResults){return}; $child=$walker.GetFirstChild($node); while($null -ne $child -and $list.Count -lt $maxResults){ $row=Row $child $parentRid $depth; if($null -ne $row){$list.Add($row)}; if($depth -lt $maxDepth){Visit $child (Rid $child) ($depth+1)}; $child=$walker.GetNextSibling($child) } }
  Visit $root (Rid $root) 1; return $list
}
if($action -eq 'windows'){
  $root=[System.Windows.Automation.AutomationElement]::RootElement; $all=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition); $out=New-Object System.Collections.Generic.List[object];
  foreach($e in $all){ if($out.Count -ge [int]$inputData.maxResults){break}; $row=Row $e; if($null -ne $row -and (-not [string]::IsNullOrWhiteSpace($row.Name))){$out.Add($row)} }; $out | ConvertTo-Json -Compress -Depth 5; exit
}
if($action -eq 'window_for_pid'){ $w=FindWindow ([int]$inputData.processId) ''; Row $w | ConvertTo-Json -Compress -Depth 5; exit }
$window=FindWindow ([int]$inputData.processId) ([string]$inputData.windowRuntimeId);
if($action -eq 'inspect'){ Walk $window ([int]$inputData.depth) ([int]$inputData.maxResults) | ConvertTo-Json -Compress -Depth 5; exit }
if($action -eq 'find'){
  $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition); $out=New-Object System.Collections.Generic.List[object];
  foreach($e in $all){ if($out.Count -ge [int]$inputData.maxResults){break}; try { $ct=$e.Current.ControlType.ProgrammaticName -replace '^ControlType\.',''; if((MatchText $e.Current.Name ([string]$inputData.name) $true) -and (MatchText $e.Current.AutomationId ([string]$inputData.automationId)) -and (MatchText $ct ([string]$inputData.controlType)) -and (MatchText $e.Current.ClassName ([string]$inputData.className))){ $row=Row $e; if($null -ne $row){$out.Add($row)} } } catch {} }; $out | ConvertTo-Json -Compress -Depth 5; exit
}
$element=FindElement $window ([string]$inputData.runtimeId);
if(-not $element.Current.IsEnabled){ throw 'UIA_ACTION_UNSUPPORTED: element is disabled' }
if($action -eq 'invoke'){ $p=$null; if(-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$p)){throw 'UIA_ACTION_UNSUPPORTED: element does not support InvokePattern'}; ([System.Windows.Automation.InvokePattern]$p).Invoke() }
elseif($action -eq 'set_value'){ $p=$null; if(-not $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){throw 'UIA_ACTION_UNSUPPORTED: element does not support ValuePattern'}; $vp=[System.Windows.Automation.ValuePattern]$p; if($vp.Current.IsReadOnly){throw 'UIA_ACTION_UNSUPPORTED: element value is read-only'}; $vp.SetValue([string]$inputData.value) }
elseif($action -eq 'focus'){ try{$element.SetFocus()}catch{throw 'UIA_ACCESS_DENIED: could not focus UI element'} }
elseif($action -eq 'select'){ $p=$null; if(-not $element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$p)){throw 'UIA_ACTION_UNSUPPORTED: element does not support SelectionItemPattern'}; ([System.Windows.Automation.SelectionItemPattern]$p).Select() }
else { throw ('INVALID_INPUT: unknown UI Automation action '+$action) }
Start-Sleep -Milliseconds 40; Row $element | ConvertTo-Json -Compress -Depth 5;`;
}
