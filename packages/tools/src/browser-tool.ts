import WebSocket from "ws";
import {
  chromium,
  type Browser as PlaywrightBrowser,
  type BrowserContext as PlaywrightBrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import { sanitizeValue } from "@qnector/core";
import type { ToolDefinition, ToolResult } from "@qnector/shared";
import {
  booleanInput,
  numberInput,
  objectInput,
  runWithActivity,
  stringInput,
  type ToolContext,
} from "./tool-result.js";

const DEFAULT_PORT = 9222;
const DEFAULT_IDLE_MS = 1_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_STYLE_PROPERTIES = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "font-size",
  "color",
  "background-color",
];
const DEFAULT_PERFORMANCE_METRICS = [
  "Documents",
  "Frames",
  "JSEventListeners",
  "Nodes",
  "LayoutCount",
  "RecalcStyleCount",
  "LayoutDuration",
  "RecalcStyleDuration",
  "ScriptDuration",
  "TaskDuration",
  "JSHeapUsedSize",
  "JSHeapTotalSize",
];

const PLAYWRIGHT_ACTIONS = new Set([
  "navigate",
  "back",
  "forward",
  "new_tab",
  "close_tab",
  "activate_tab",
  "find",
  "click",
  "dblclick",
  "hover",
  "focus",
  "fill",
  "type",
  "press",
  "select",
  "check",
  "uncheck",
  "scroll",
  "get_text",
  "get_value",
  "get_attributes",
  "wait",
  "upload_file",
]);

const playwrightConnections = new Map<string, PlaywrightBrowser>();

interface BrowserTarget {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}

interface BrowserNodeSummary {
  nodeId: number;
  tag: string;
  id?: string;
  classes: string[];
  attributes: Record<string, string>;
  text: string;
  role?: string;
  visible: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export const browserDefinition: ToolDefinition = {
  name: "browser",
  description:
    "Automate and inspect a dedicated Chrome/Edge browser for web-app development. Managed browser work is headless by default so intermediate QC does not open or focus visible windows. Set headless=false only for intentional final presentation and pair it with presentToUser=true. Qnector can navigate normal http/https sites, use persistent named development profiles, find controls by CSS/text/role/label/placeholder/test-id, click/fill/type/press/select/check/upload/wait, manage tabs, capture screenshots, and inspect DOM/console/network/performance through local CDP. The DevTools endpoint itself remains loopback-only.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "status",
          "targets",
          "tabs",
          "console",
          "network_errors",
          "reload",
          "navigate",
          "back",
          "forward",
          "new_tab",
          "close_tab",
          "activate_tab",
          "find",
          "click",
          "dblclick",
          "hover",
          "focus",
          "fill",
          "type",
          "press",
          "select",
          "check",
          "uncheck",
          "scroll",
          "get_text",
          "get_value",
          "get_attributes",
          "wait",
          "upload_file",
          "screenshot",
          "dom_snapshot",
          "query",
          "inspect",
          "computed_style",
          "evaluate",
          "requests",
          "performance",
          "launch",
          "close",
          "restart",
          "open_local",
          "open_url",
          "profile_status",
          "profile_reset",
        ],
      },
      host: { type: "string", enum: ["localhost", "127.0.0.1", "::1"] },
      port: { type: "integer", minimum: 1, maximum: 65535 },
      browser: { type: "string", enum: ["auto", "chrome", "edge"] },
      executablePath: { type: "string" },
      profile: { type: "string", maxLength: 64 },
      persistentProfile: { type: "boolean" },
      headless: {
        type: "boolean",
        description:
          "Run managed browser without visible UI. Defaults to true.",
      },
      presentToUser: {
        type: "boolean",
        description:
          "Explicit opt-in required when headless=false or when opening a URL in an already-visible managed browser.",
      },
      url: { type: "string" },
      targetId: { type: "string" },
      maxResults: { type: "integer", minimum: 1, maximum: 1000 },
      idleMs: { type: "integer", minimum: 100, maximum: 5000 },
      observeMs: { type: "integer", minimum: 0, maximum: 10000 },
      format: { type: "string", enum: ["png", "jpeg"] },
      maxWidth: { type: "integer", minimum: 320, maximum: 4096 },
      fullPage: { type: "boolean" },
      maxDepth: { type: "integer", minimum: 1, maximum: 20 },
      selector: { type: "string" },
      text: { type: "string" },
      role: { type: "string" },
      name: { type: "string" },
      label: { type: "string" },
      placeholder: { type: "string" },
      testId: { type: "string" },
      exact: { type: "boolean" },
      index: { type: "integer", minimum: 0 },
      nodeId: { type: "integer", minimum: 1 },
      value: { type: "string" },
      values: { type: "array", items: { type: "string" }, maxItems: 100 },
      key: { type: "string" },
      paths: { type: "array", items: { type: "string" }, maxItems: 100 },
      button: { type: "string", enum: ["left", "right", "middle"] },
      clickCount: { type: "integer", minimum: 1, maximum: 3 },
      delayMs: { type: "integer", minimum: 0, maximum: 5000 },
      timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
      waitUntil: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle", "commit"],
      },
      condition: {
        type: "string",
        enum: [
          "attached",
          "detached",
          "visible",
          "hidden",
          "text",
          "value",
          "url",
        ],
      },
      intervalMs: { type: "integer", minimum: 50, maximum: 5000 },
      deltaX: { type: "number" },
      deltaY: { type: "number" },
      force: { type: "boolean" },
      properties: { type: "array", items: { type: "string" }, maxItems: 50 },
      expression: { type: "string", maxLength: 20000 },
      awaitPromise: { type: "boolean" },
      maxChars: { type: "integer", minimum: 1000, maximum: 200000 },
      reloadPage: { type: "boolean" },
      metrics: { type: "array", items: { type: "string" }, maxItems: 50 },
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

export async function executeBrowser(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(
    context,
    "browser",
    action,
    browserActivityInput(action, object, input),
    async () => {
      const host = (stringInput(object, "host") ?? "127.0.0.1").toLowerCase();
      if (!LOOPBACK_HOSTS.has(host))
        throw new Error(
          "BROWSER_TARGET_DENIED: the DevTools endpoint must be localhost/loopback",
        );
      const port = clamp(numberInput(object, "port", DEFAULT_PORT), 1, 65_535);

      if (
        [
          "launch",
          "close",
          "restart",
          "open_local",
          "open_url",
          "profile_status",
          "profile_reset",
        ].includes(action)
      ) {
        const runtime = context.browserRuntime;
        if (!runtime)
          throw new Error(
            "UNSUPPORTED_CAPABILITY: managed browser runtime is not configured in this Qnector runtime",
          );
        if (action === "profile_status") {
          const snapshot = runtime.status();
          return {
            summary: snapshot.running
              ? `Managed ${snapshot.browser} browser is running on ${snapshot.host}:${snapshot.port}`
              : "Managed browser is not running",
            data: snapshot,
          };
        }
        if (action === "profile_reset") {
          const result = await runtime.resetProfile(
            stringInput(object, "profile") ?? "default",
          );
          return {
            summary: `Reset browser profile ${result.profile}`,
            data: result,
          };
        }
        if (action === "close") {
          const snapshot = await runtime.close();
          return { summary: "Closed managed browser runtime", data: snapshot };
        }
        if (action === "open_local" || action === "open_url") {
          const current = runtime.status();
          if (!current.headless && object.presentToUser !== true)
            throw new Error(
              "VISIBLE_UI_BLOCKED: opening a URL in a visible managed browser is presentation-only. Keep intermediate work headless or set presentToUser=true when intentionally showing final output to the user.",
            );
          const url = stringInput(object, "url", true)!;
          const target = await runtime.openUrl(url);
          return {
            summary: `Opened browser URL ${url}`,
            data: { url, target },
          };
        }
        const browser = (stringInput(object, "browser") ?? "auto") as
          "auto" | "chrome" | "edge";
        const headless = booleanInput(object, "headless", true);
        if (!headless && object.presentToUser !== true)
          throw new Error(
            "VISIBLE_UI_BLOCKED: visible managed-browser launch is presentation-only. Keep intermediate work headless or set presentToUser=true when intentionally showing final output to the user.",
          );
        const options = {
          browser,
          executablePath: stringInput(object, "executablePath"),
          port,
          url: stringInput(object, "url"),
          profile: stringInput(object, "profile") ?? "default",
          persistentProfile: booleanInput(object, "persistentProfile", false),
          headless,
        };
        const snapshot =
          action === "restart"
            ? await runtime.restart(options)
            : await runtime.launch(options);
        return {
          summary: `${action === "restart" ? "Restarted" : "Launched"} managed ${snapshot.browser} browser on ${snapshot.host}:${snapshot.port}${snapshot.persistentProfile ? ` using persistent profile ${snapshot.profileName}` : ""}`,
          data: snapshot,
        };
      }

      if (action === "status") {
        const version = await fetchJson<Record<string, unknown>>(
          `http://${formatHost(host)}:${port}/json/version`,
        );
        const debuggerUrl =
          typeof version.webSocketDebuggerUrl === "string" &&
          isAllowedWebSocketUrl(version.webSocketDebuggerUrl)
            ? version.webSocketDebuggerUrl
            : undefined;
        return {
          summary: `Browser DevTools is available on ${host}:${port}`,
          data: {
            host,
            port,
            browser: version.Browser,
            protocolVersion: version["Protocol-Version"],
            ...(debuggerUrl ? { webSocketDebuggerUrl: debuggerUrl } : {}),
          },
        };
      }

      const targets = await listTargets(host, port);
      if (action === "targets" || action === "tabs") {
        return {
          summary: `Found ${targets.length} browser page target(s)`,
          data: { host, port, targets: sanitizeValue(targets).value },
        };
      }
      if (PLAYWRIGHT_ACTIONS.has(action))
        return executePlaywrightAction(context, host, port, action, object);

      const target = chooseTarget(targets, stringInput(object, "targetId"));

      if (action === "reload") {
        await withCdpClient(target, async (client) => {
          await client.command("Page.enable");
          await client.command("Page.reload", { ignoreCache: false });
        });
        return {
          summary: `Reloaded browser target ${target.id}`,
          data: { target: sanitizeValue(target).value },
        };
      }

      if (action === "screenshot") {
        const format = stringInput(object, "format") ?? "png";
        if (!["png", "jpeg"].includes(format))
          throw new Error(
            "INVALID_INPUT: browser screenshot format must be png or jpeg",
          );
        const maxWidth = clamp(
          numberInput(object, "maxWidth", 2_048),
          320,
          4_096,
        );
        const fullPage = booleanInput(object, "fullPage", false);
        const captured = await captureScreenshot(
          target,
          format as "png" | "jpeg",
          maxWidth,
          fullPage,
        );
        return {
          summary: `Captured ${format.toUpperCase()} screenshot from ${target.url}`,
          data: {
            targetId: target.id,
            url: target.url,
            mimeType: captured.mimeType,
            width: captured.width,
            height: captured.height,
            sizeBytes: captured.sizeBytes,
            fullPage,
          },
          attachments: [captured],
        };
      }

      if (action === "dom_snapshot") {
        const maxResults = clamp(
          numberInput(object, "maxResults", 300),
          1,
          1_000,
        );
        const maxDepth = clamp(numberInput(object, "maxDepth", 8), 1, 20);
        const elements = await domSnapshot(target, maxResults, maxDepth);
        return {
          summary: `Captured ${elements.length} bounded DOM element(s) from ${target.url}`,
          data: {
            target: sanitizeValue(target).value,
            elements: sanitizeValue(elements).value,
          },
          truncated: elements.length >= maxResults,
        };
      }

      if (action === "query") {
        const selector = stringInput(object, "selector", true)!;
        if (selector.length > 2_000)
          throw new Error(
            "INVALID_INPUT: selector must be 2000 characters or fewer",
          );
        const maxResults = clamp(numberInput(object, "maxResults", 50), 1, 500);
        const elements = await queryDom(target, selector, maxResults);
        return {
          summary: `Query '${selector}' returned ${elements.length} element(s)`,
          data: {
            targetId: target.id,
            selector,
            elements: sanitizeValue(elements).value,
          },
          truncated: elements.length >= maxResults,
        };
      }

      if (action === "inspect") {
        const nodeId = clamp(
          numberInput(object, "nodeId", 0),
          1,
          2_147_483_647,
        );
        const element = await inspectBackendNode(target, nodeId);
        return {
          summary: `Inspected ${element.tag} node ${nodeId}`,
          data: { targetId: target.id, element: sanitizeValue(element).value },
        };
      }

      if (action === "computed_style") {
        const nodeId = clamp(
          numberInput(object, "nodeId", 0),
          1,
          2_147_483_647,
        );
        const properties = stringArrayInput(
          object,
          "properties",
          DEFAULT_STYLE_PROPERTIES,
          50,
        );
        const styles = await computedStyle(target, nodeId, properties);
        return {
          summary: `Read ${Object.keys(styles).length} computed style value(s) for node ${nodeId}`,
          data: {
            targetId: target.id,
            nodeId,
            styles: sanitizeValue(styles).value,
          },
        };
      }

      if (action === "evaluate") {
        const expression = stringInput(object, "expression", true)!;
        if (expression.length > 20_000)
          throw new Error(
            "INVALID_INPUT: browser evaluate expression must be 20000 characters or fewer",
          );
        assertSafeEvaluateExpression(expression);
        const awaitPromise = booleanInput(object, "awaitPromise", true);
        const maxChars = clamp(
          numberInput(object, "maxChars", 50_000),
          1_000,
          200_000,
        );
        const evaluated = await evaluateExpression(
          target,
          expression,
          awaitPromise,
          maxChars,
        );
        return {
          summary: `Evaluated bounded JavaScript in browser target ${target.id}`,
          data: {
            targetId: target.id,
            result: sanitizeValue(evaluated).value,
          },
        };
      }

      if (action === "requests") {
        const maxResults = clamp(
          numberInput(object, "maxResults", 100),
          1,
          500,
        );
        const idleMs = clamp(
          numberInput(object, "idleMs", DEFAULT_IDLE_MS),
          100,
          5_000,
        );
        const reloadPage = booleanInput(object, "reloadPage", false);
        const captured = await collectNetworkRequests(
          target,
          idleMs,
          maxResults,
          reloadPage,
        );
        return {
          summary: `Captured ${captured.requests.length} bounded network request(s) from ${target.url}`,
          data: {
            targetId: target.id,
            reloadPage,
            requests: sanitizeValue(captured.requests).value,
          },
          truncated: captured.truncated,
        };
      }

      if (action === "performance") {
        const metrics = stringArrayInput(
          object,
          "metrics",
          DEFAULT_PERFORMANCE_METRICS,
          50,
        );
        const snapshot = await performanceSnapshot(target, metrics);
        return {
          summary: `Read ${Object.keys(snapshot.metrics).length} performance metric(s) from ${target.url}`,
          data: {
            targetId: target.id,
            ...sanitizeValue(snapshot).value,
          },
        };
      }

      const maxResults = clamp(numberInput(object, "maxResults", 100), 1, 500);
      const idleMs = clamp(
        numberInput(object, "idleMs", DEFAULT_IDLE_MS),
        100,
        5_000,
      );
      if (action === "console") {
        const events = await collectCdpEvents(
          target,
          ["Runtime.enable", "Log.enable"],
          [
            "Runtime.consoleAPICalled",
            "Runtime.exceptionThrown",
            "Log.entryAdded",
          ],
          idleMs,
          maxResults,
        );
        return {
          summary: `Collected ${events.length} console event(s) from ${target.url}`,
          data: {
            target: sanitizeValue(target).value,
            events: sanitizeValue(events).value,
          },
          truncated: events.length >= maxResults,
        };
      }
      if (action === "network_errors") {
        const events = await collectCdpEvents(
          target,
          ["Network.enable"],
          ["Network.loadingFailed", "Network.responseReceived"],
          idleMs,
          maxResults,
        );
        const errors = events.filter((event) => {
          const params = event.params ?? {};
          const response = params.response as
            Record<string, unknown> | undefined;
          return (
            event.method === "Network.loadingFailed" ||
            Number(response?.status) >= 400
          );
        });
        return {
          summary: `Collected ${errors.length} network error(s) from ${target.url}`,
          data: {
            target: sanitizeValue(target).value,
            errors: sanitizeValue(errors).value,
          },
          truncated: errors.length >= maxResults,
        };
      }
      throw new Error(`INVALID_ACTION: Unknown browser action '${action}'`);
    },
  );
}

interface PlaywrightObservedEvent {
  type: "console" | "pageerror" | "response" | "requestfailed";
  timestamp: string;
  level?: string;
  text?: string;
  url?: string;
  method?: string;
  resourceType?: string;
  status?: number;
  errorText?: string;
}

async function executePlaywrightAction(
  context: ToolContext,
  host: string,
  port: number,
  action: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const browser = await playwrightBrowser(host, port);
  const contexts = browser.contexts();
  const browserContext = contexts[0];
  if (!browserContext)
    throw new Error(
      "BROWSER_AUTOMATION_UNAVAILABLE: the connected browser has no default context",
    );

  if (action === "new_tab") {
    const page = await browserContext.newPage();
    const url = stringInput(input, "url");
    if (url) {
      assertAutomationUrl(url);
      await page.goto(url, {
        waitUntil: waitUntilInput(input),
        timeout: browserTimeout(input),
      });
    }
    await page.bringToFront();
    const data = await playwrightPageSummary(browserContext, page);
    return { summary: `Opened browser tab ${data.targetId}`, data };
  }

  const page = await playwrightPage(
    browserContext,
    stringInput(input, "targetId"),
  );
  const timeoutMs = browserTimeout(input);

  if (action === "close_tab") {
    const before = await playwrightPageSummary(browserContext, page);
    await page.close({ runBeforeUnload: true });
    return { summary: `Closed browser tab ${before.targetId}`, data: before };
  }
  if (action === "activate_tab") {
    await page.bringToFront();
    const data = await playwrightPageSummary(browserContext, page);
    return { summary: `Activated browser tab ${data.targetId}`, data };
  }
  if (action === "navigate") {
    const url = stringInput(input, "url", true)!;
    assertAutomationUrl(url);
    const observed = await observePlaywrightAction(
      page,
      numberInput(input, "observeMs", 300),
      async () => {
        const response = await page.goto(url, {
          waitUntil: waitUntilInput(input),
          timeout: timeoutMs,
        });
        return {
          status: response?.status() ?? null,
          responseUrl: response?.url() ?? null,
        };
      },
    );
    return {
      summary: `Navigated browser to ${page.url()}`,
      data: {
        ...(await playwrightPageSummary(browserContext, page)),
        navigation: observed.value,
        events: observed.events,
      },
    };
  }
  if (action === "back" || action === "forward") {
    const observed = await observePlaywrightAction(
      page,
      numberInput(input, "observeMs", 250),
      async () => {
        const beforeUrl = page.url();
        const response =
          action === "back"
            ? await page.goBack({ waitUntil: "commit", timeout: timeoutMs })
            : await page.goForward({ waitUntil: "commit", timeout: timeoutMs });
        const requested = waitUntilInput(input);
        if (requested !== "commit") {
          await page
            .waitForLoadState(requested, {
              timeout: Math.min(timeoutMs, 5_000),
            })
            .catch((error) => {
              if (page.url() === beforeUrl) throw error;
            });
        }
        return {
          status: response?.status() ?? null,
          beforeUrl,
          finalUrl: page.url(),
        };
      },
    );
    return {
      summary: `${action === "back" ? "Went back" : "Went forward"} to ${page.url()}`,
      data: {
        ...(await playwrightPageSummary(browserContext, page)),
        navigation: observed.value,
        events: observed.events,
      },
    };
  }
  if (action === "find") {
    const base = playwrightLocatorBase(page, input);
    const count = await base.count();
    const maxResults = clamp(numberInput(input, "maxResults", 50), 1, 500);
    const requestedIndex = optionalInteger(input, "index");
    const indexes =
      requestedIndex === undefined
        ? Array.from(
            { length: Math.min(count, maxResults) },
            (_, index) => index,
          )
        : requestedIndex < count
          ? [requestedIndex]
          : [];
    const elements: Array<Record<string, unknown>> = [];
    for (const index of indexes)
      elements.push({
        index,
        ...(await playwrightElementSummary(base.nth(index))),
      });
    return {
      summary: `Found ${elements.length} browser element(s) from ${count} match(es)`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        locator: locatorDescription(input),
        count,
        elements,
      },
      truncated: requestedIndex === undefined && count > maxResults,
    };
  }

  if (action === "scroll" && !hasLocatorInput(input)) {
    const deltaX = finiteInput(input, "deltaX", 0);
    const deltaY = finiteInput(input, "deltaY", 600);
    await page.mouse.wheel(deltaX, deltaY);
    return {
      summary: `Scrolled browser viewport by ${deltaX}, ${deltaY}`,
      data: {
        ...(await playwrightPageSummary(browserContext, page)),
        deltaX,
        deltaY,
      },
    };
  }

  if (
    action === "wait" &&
    (stringInput(input, "condition") ?? "visible") === "url"
  ) {
    const url = stringInput(input, "url", true)!;
    await page.waitForURL(url, { timeout: timeoutMs });
    return {
      summary: `Browser URL matched ${url}`,
      data: await playwrightPageSummary(browserContext, page),
    };
  }

  const locator = playwrightLocator(page, input);

  if (action === "click" || action === "dblclick") {
    const observed = await observePlaywrightAction(
      page,
      numberInput(input, "observeMs", 300),
      async () => {
        const options = {
          button: (stringInput(input, "button") ?? "left") as
            "left" | "right" | "middle",
          timeout: timeoutMs,
          force: booleanInput(input, "force", false),
        };
        if (action === "dblclick") await locator.dblclick(options);
        else
          await locator.click({
            ...options,
            clickCount: clamp(numberInput(input, "clickCount", 1), 1, 3),
          });
        return playwrightElementSummary(locator);
      },
    );
    return {
      summary: `${action === "dblclick" ? "Double-clicked" : "Clicked"} ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        element: observed.value,
        events: observed.events,
      },
    };
  }
  if (action === "hover") {
    await locator.hover({
      timeout: timeoutMs,
      force: booleanInput(input, "force", false),
    });
    return {
      summary: `Hovered ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        element: await playwrightElementSummary(locator),
      },
    };
  }
  if (action === "focus") {
    await locator.focus({ timeout: timeoutMs });
    return {
      summary: `Focused ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        element: await playwrightElementSummary(locator),
      },
    };
  }
  if (action === "fill") {
    const value = stringInput(input, "value", true)!;
    const observed = await observePlaywrightAction(
      page,
      numberInput(input, "observeMs", 0),
      async () => {
        await locator.fill(value, {
          timeout: timeoutMs,
          force: booleanInput(input, "force", false),
        });
        return playwrightElementSummary(locator);
      },
    );
    return {
      summary: `Filled ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        element: observed.value,
        events: observed.events,
      },
    };
  }
  if (action === "type") {
    const value = stringInput(input, "value", true)!;
    const observed = await observePlaywrightAction(
      page,
      numberInput(input, "observeMs", 0),
      async () => {
        await locator.pressSequentially(value, {
          delay: clamp(numberInput(input, "delayMs", 0), 0, 5_000),
          timeout: timeoutMs,
        });
        return playwrightElementSummary(locator);
      },
    );
    return {
      summary: `Typed into ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        element: observed.value,
        events: observed.events,
      },
    };
  }
  if (action === "press") {
    const key = stringInput(input, "key", true)!;
    const observed = await observePlaywrightAction(
      page,
      numberInput(input, "observeMs", 300),
      async () => {
        await locator.press(key, { timeout: timeoutMs });
        return playwrightElementSummary(locator);
      },
    );
    return {
      summary: `Pressed ${key} on ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        element: observed.value,
        events: observed.events,
      },
    };
  }
  if (action === "select") {
    const values = rawStringArrayInput(input, "values");
    const selection =
      values.length > 0 ? values : [stringInput(input, "value", true)!];
    const observed = await observePlaywrightAction(
      page,
      numberInput(input, "observeMs", 250),
      async () => locator.selectOption(selection, { timeout: timeoutMs }),
    );
    return {
      summary: `Selected ${observed.value.length} option(s) in ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        selected: observed.value,
        events: observed.events,
      },
    };
  }
  if (action === "check" || action === "uncheck") {
    const observed = await observePlaywrightAction(
      page,
      numberInput(input, "observeMs", 250),
      async () => {
        if (action === "check")
          await locator.check({
            timeout: timeoutMs,
            force: booleanInput(input, "force", false),
          });
        else
          await locator.uncheck({
            timeout: timeoutMs,
            force: booleanInput(input, "force", false),
          });
        return playwrightElementSummary(locator);
      },
    );
    return {
      summary: `${action === "check" ? "Checked" : "Unchecked"} ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        element: observed.value,
        events: observed.events,
      },
    };
  }
  if (action === "scroll") {
    await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
    return {
      summary: `Scrolled ${locatorDescription(input)} into view`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        element: await playwrightElementSummary(locator),
      },
    };
  }
  if (action === "get_text") {
    const text = await locator
      .innerText({ timeout: timeoutMs })
      .catch(async () =>
        String((await locator.textContent({ timeout: timeoutMs })) ?? ""),
      );
    return {
      summary: `Read text from ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        text: text.slice(0, 100_000),
        truncated: text.length > 100_000,
      },
      truncated: text.length > 100_000,
    };
  }
  if (action === "get_value") {
    const value = await locator.evaluate((element) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      )
        return element.value;
      return element.getAttribute("value") ?? element.textContent ?? "";
    });
    const text = String(value ?? "");
    return {
      summary: `Read value from ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        value: text.slice(0, 100_000),
        truncated: text.length > 100_000,
      },
      truncated: text.length > 100_000,
    };
  }
  if (action === "get_attributes") {
    const attributes = await locator.evaluate((element) =>
      Object.fromEntries(
        Array.from(element.attributes)
          .slice(0, 100)
          .map((attribute) => [attribute.name, attribute.value]),
      ),
    );
    return {
      summary: `Read attributes from ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        attributes,
      },
    };
  }
  if (action === "wait") {
    const condition = stringInput(input, "condition") ?? "visible";
    if (["attached", "detached", "visible", "hidden"].includes(condition)) {
      await locator.waitFor({
        state: condition as "attached" | "detached" | "visible" | "hidden",
        timeout: timeoutMs,
      });
    } else if (condition === "text" || condition === "value") {
      const expected =
        condition === "text"
          ? stringInput(input, "text", true)!
          : stringInput(input, "value", true)!;
      await waitForLocatorContent(
        locator,
        condition,
        expected,
        booleanInput(input, "exact", false),
        timeoutMs,
        clamp(numberInput(input, "intervalMs", 150), 50, 5_000),
      );
    } else {
      throw new Error(
        `INVALID_INPUT: unsupported browser wait condition '${condition}'`,
      );
    }
    return {
      summary: `Browser wait condition '${condition}' matched`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        condition,
        element: await playwrightElementSummary(locator).catch(() => null),
      },
    };
  }
  if (action === "upload_file") {
    const paths = rawStringArrayInput(input, "paths");
    if (paths.length === 0)
      throw new Error(
        "INVALID_INPUT: paths must contain at least one file path",
      );
    const resolved = paths.map((entry) => context.workspace.resolve(entry));
    await locator.setInputFiles(resolved, { timeout: timeoutMs });
    return {
      summary: `Uploaded ${resolved.length} file(s) through ${locatorDescription(input)}`,
      data: {
        target: await playwrightPageSummary(browserContext, page),
        paths: resolved,
      },
    };
  }

  throw new Error(
    `INVALID_ACTION: Unknown Playwright browser action '${action}'`,
  );
}

async function playwrightBrowser(
  host: string,
  port: number,
): Promise<PlaywrightBrowser> {
  const endpoint = `http://${formatHost(host)}:${port}`;
  const existing = playwrightConnections.get(endpoint);
  if (existing?.isConnected()) return existing;
  if (existing) playwrightConnections.delete(endpoint);
  try {
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 5_000 });
    playwrightConnections.set(endpoint, browser);
    browser.on("disconnected", () => {
      if (playwrightConnections.get(endpoint) === browser)
        playwrightConnections.delete(endpoint);
    });
    return browser;
  } catch (error) {
    throw new Error(
      `BROWSER_AUTOMATION_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function playwrightPage(
  context: PlaywrightBrowserContext,
  targetId?: string,
): Promise<Page> {
  const pages = context.pages();
  if (pages.length === 0)
    throw new Error("BROWSER_NO_TARGET: the browser has no page tabs");
  if (!targetId) return pages[0]!;
  for (const page of pages) {
    const id = await playwrightTargetId(context, page).catch(() => null);
    if (id === targetId) return page;
  }
  throw new Error(`BROWSER_TARGET_NOT_FOUND: '${targetId}' was not found`);
}

async function playwrightTargetId(
  context: PlaywrightBrowserContext,
  page: Page,
): Promise<string> {
  const session = await context.newCDPSession(page);
  try {
    const result = (await session.send("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: string };
    };
    const targetId = result.targetInfo?.targetId;
    if (!targetId) throw new Error("CDP returned no targetId");
    return targetId;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function playwrightPageSummary(
  context: PlaywrightBrowserContext,
  page: Page,
): Promise<Record<string, unknown>> {
  return {
    targetId: await playwrightTargetId(context, page).catch(() => null),
    url: page.url(),
    title: await page.title().catch(() => ""),
  };
}

function playwrightLocatorBase(
  page: Page,
  input: Record<string, unknown>,
): Locator {
  const selector = stringInput(input, "selector");
  const exact = booleanInput(input, "exact", false);
  if (selector) {
    if (selector.length > 4_000)
      throw new Error(
        "INVALID_INPUT: selector must be 4000 characters or fewer",
      );
    return page.locator(selector);
  }
  const role = stringInput(input, "role");
  if (role)
    return page.getByRole(
      role.toLowerCase() as Parameters<Page["getByRole"]>[0],
      {
        ...(stringInput(input, "name")
          ? { name: stringInput(input, "name")! }
          : {}),
        exact,
      },
    );
  const label = stringInput(input, "label");
  if (label) return page.getByLabel(label, { exact });
  const placeholder = stringInput(input, "placeholder");
  if (placeholder) return page.getByPlaceholder(placeholder, { exact });
  const testId = stringInput(input, "testId");
  if (testId) return page.getByTestId(testId);
  const text = stringInput(input, "text");
  if (text) return page.getByText(text, { exact });
  throw new Error(
    "INVALID_INPUT: provide one browser locator: selector, role (+ optional name), label, placeholder, testId, or text",
  );
}

function playwrightLocator(
  page: Page,
  input: Record<string, unknown>,
): Locator {
  const base = playwrightLocatorBase(page, input);
  return base.nth(Math.max(0, optionalInteger(input, "index") ?? 0));
}

function locatorDescription(input: Record<string, unknown>): string {
  const index = optionalInteger(input, "index") ?? 0;
  for (const key of [
    "selector",
    "role",
    "label",
    "placeholder",
    "testId",
    "text",
  ])
    if (typeof input[key] === "string" && input[key])
      return `${key}=${JSON.stringify(input[key])}[${index}]`;
  return `element[${index}]`;
}

function hasLocatorInput(input: Record<string, unknown>): boolean {
  return ["selector", "role", "label", "placeholder", "testId", "text"].some(
    (key) => typeof input[key] === "string" && Boolean(input[key]),
  );
}

async function playwrightElementSummary(
  locator: Locator,
): Promise<Record<string, unknown>> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const input = element instanceof HTMLInputElement ? element : null;
    const select = element instanceof HTMLSelectElement ? element : null;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList).slice(0, 20),
      text: String(
        (element as HTMLElement).innerText ?? element.textContent ?? "",
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2_000),
      role: element.getAttribute("role"),
      ariaLabel: element.getAttribute("aria-label"),
      name: element.getAttribute("name"),
      inputType: input?.type ?? null,
      value:
        input?.type === "password"
          ? null
          : (input?.value ?? select?.value ?? element.getAttribute("value")),
      checked:
        input && ["checkbox", "radio"].includes(input.type)
          ? input.checked
          : null,
      disabled:
        "disabled" in element
          ? Boolean((element as HTMLButtonElement).disabled)
          : false,
      visible:
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  });
}

async function observePlaywrightAction<T>(
  page: Page,
  observeMs: number,
  work: () => Promise<T>,
): Promise<{ value: T; events: PlaywrightObservedEvent[] }> {
  observeMs = clamp(observeMs, 0, 10_000);
  if (observeMs === 0) return { value: await work(), events: [] };
  const events: PlaywrightObservedEvent[] = [];
  const push = (event: PlaywrightObservedEvent): void => {
    if (events.length < 100) events.push(event);
  };
  const onConsole = (message: { type(): string; text(): string }): void =>
    push({
      type: "console",
      timestamp: new Date().toISOString(),
      level: message.type(),
      text: message.text().slice(0, 2_000),
    });
  const onPageError = (error: Error): void =>
    push({
      type: "pageerror",
      timestamp: new Date().toISOString(),
      text: error.message.slice(0, 2_000),
    });
  const onResponse = (response: {
    status(): number;
    url(): string;
    request(): { method(): string; resourceType(): string };
  }): void =>
    push({
      type: "response",
      timestamp: new Date().toISOString(),
      status: response.status(),
      url: response.url().slice(0, 4_000),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
    });
  const onRequestFailed = (request: {
    url(): string;
    method(): string;
    resourceType(): string;
    failure(): { errorText: string } | null;
  }): void =>
    push({
      type: "requestfailed",
      timestamp: new Date().toISOString(),
      url: request.url().slice(0, 4_000),
      method: request.method(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText.slice(0, 2_000),
    });
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  try {
    const value = await work();
    if (observeMs > 0) await page.waitForTimeout(observeMs);
    return { value, events };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }
}

async function waitForLocatorContent(
  locator: Locator,
  kind: "text" | "value",
  expected: string,
  exact: boolean,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const actual =
        kind === "text"
          ? await locator.innerText({ timeout: Math.min(intervalMs, 1_000) })
          : await locator.evaluate((element) => {
              if (
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement ||
                element instanceof HTMLSelectElement
              )
                return element.value;
              return element.getAttribute("value") ?? "";
            });
      const matched = exact
        ? actual === expected
        : String(actual).includes(expected);
      if (matched) return;
    } catch {
      // The element can be between render states while polling.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `BROWSER_WAIT_TIMEOUT: ${kind} did not match ${JSON.stringify(expected)} within ${timeoutMs} ms`,
  );
}

function waitUntilInput(
  input: Record<string, unknown>,
): "load" | "domcontentloaded" | "networkidle" | "commit" {
  const value = stringInput(input, "waitUntil") ?? "domcontentloaded";
  if (!["load", "domcontentloaded", "networkidle", "commit"].includes(value))
    throw new Error("INVALID_INPUT: invalid waitUntil value");
  return value as "load" | "domcontentloaded" | "networkidle" | "commit";
}

function browserTimeout(input: Record<string, unknown>): number {
  return clamp(numberInput(input, "timeoutMs", 30_000), 100, 120_000);
}

function optionalInteger(
  input: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`INVALID_INPUT: ${key} must be a number`);
  return Math.floor(value);
}

function finiteInput(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`INVALID_INPUT: ${key} must be a finite number`);
  return value;
}

function rawStringArrayInput(
  input: Record<string, unknown>,
  key: string,
): string[] {
  const value = input[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`INVALID_INPUT: ${key} must be an array of strings`);
  return value.slice(0, 100) as string[];
}

function assertAutomationUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`INVALID_INPUT: invalid browser URL '${value}'`);
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(
      "BROWSER_TARGET_DENIED: browser automation supports http:// and https:// URLs",
    );
}

function browserActivityInput(
  action: string,
  object: Record<string, unknown>,
  original: unknown,
): unknown {
  if (!["fill", "type"].includes(action)) return original;
  return {
    ...object,
    ...(object.value === undefined ? {} : { value: "[FORM_VALUE]" }),
  };
}

async function captureScreenshot(
  target: BrowserTarget,
  format: "png" | "jpeg",
  maxWidth: number,
  fullPage: boolean,
) {
  return withCdpClient(target, async (client) => {
    await client.command("Page.enable");
    const metrics = await client.command<{
      cssVisualViewport?: {
        pageX?: number;
        pageY?: number;
        clientWidth?: number;
        clientHeight?: number;
      };
      cssContentSize?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      };
    }>("Page.getLayoutMetrics");
    const sourceWidth = Math.max(
      1,
      Number(
        fullPage
          ? (metrics.cssContentSize?.width ?? maxWidth)
          : (metrics.cssVisualViewport?.clientWidth ?? maxWidth),
      ),
    );
    const sourceHeight = Math.max(
      1,
      Math.min(
        30_000,
        Number(
          fullPage
            ? (metrics.cssContentSize?.height ?? 900)
            : (metrics.cssVisualViewport?.clientHeight ?? 900),
        ),
      ),
    );
    const scale = Math.max(0.1, Math.min(1, maxWidth / sourceWidth));
    const x = Number(
      fullPage
        ? (metrics.cssContentSize?.x ?? 0)
        : (metrics.cssVisualViewport?.pageX ?? 0),
    );
    const y = Number(
      fullPage
        ? (metrics.cssContentSize?.y ?? 0)
        : (metrics.cssVisualViewport?.pageY ?? 0),
    );
    const result = await client.command<{ data?: string }>(
      "Page.captureScreenshot",
      {
        format,
        ...(format === "jpeg" ? { quality: 85 } : {}),
        fromSurface: true,
        captureBeyondViewport: fullPage,
        clip: { x, y, width: sourceWidth, height: sourceHeight, scale },
      },
    );
    if (!result.data)
      throw new Error(
        "BROWSER_SCREENSHOT_FAILED: CDP returned no screenshot data",
      );
    const bytes = Buffer.from(result.data, "base64");
    if (bytes.length > 20 * 1024 * 1024)
      throw new Error(
        "BROWSER_SCREENSHOT_TOO_LARGE: screenshot exceeds 20 MiB; lower maxWidth or disable fullPage",
      );
    return {
      type: "image" as const,
      mimeType:
        format === "jpeg" ? ("image/jpeg" as const) : ("image/png" as const),
      dataBase64: result.data,
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
      sizeBytes: bytes.length,
    };
  });
}

async function domSnapshot(
  target: BrowserTarget,
  maxResults: number,
  maxDepth: number,
): Promise<Array<Record<string, unknown>>> {
  return withCdpClient(target, async (client) => {
    const expression = `(() => { const max=${maxResults}; const maxDepth=${maxDepth}; const out=[]; const q=[[document.documentElement,0]]; while(q.length&&out.length<max){ const [el,depth]=q.shift(); if(!el||el.nodeType!==1) continue; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); const visible=s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0; out.push({tag:el.tagName.toLowerCase(),id:el.id||null,classes:Array.from(el.classList||[]).slice(0,12),text:String(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,300),role:el.getAttribute('role')||null,visible,bounds:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},depth}); if(depth<maxDepth){ for(const child of el.children) q.push([child,depth+1]); } } return out; })()`;
    const evaluated = await client.command<{
      result?: { value?: Array<Record<string, unknown>> };
    }>("Runtime.evaluate", { expression, returnByValue: true });
    return Array.isArray(evaluated.result?.value)
      ? evaluated.result!.value!
      : [];
  });
}

async function queryDom(
  target: BrowserTarget,
  selector: string,
  maxResults: number,
): Promise<BrowserNodeSummary[]> {
  return withCdpClient(target, async (client) => {
    await client.command("DOM.enable");
    const document = await client.command<{ root?: { nodeId?: number } }>(
      "DOM.getDocument",
      { depth: 1, pierce: true },
    );
    const rootNodeId = Number(document.root?.nodeId ?? 0);
    if (!rootNodeId)
      throw new Error("BROWSER_DOM_ERROR: CDP returned no document root");
    const queried = await client.command<{ nodeIds?: number[] }>(
      "DOM.querySelectorAll",
      {
        nodeId: rootNodeId,
        selector,
      },
    );
    const nodeIds = (queried.nodeIds ?? []).slice(0, maxResults);
    const results: BrowserNodeSummary[] = [];
    for (const nodeId of nodeIds) {
      const described = await client.command<{ node?: CdpDomNode }>(
        "DOM.describeNode",
        {
          nodeId,
          depth: 0,
          pierce: true,
        },
      );
      const backendNodeId = Number(described.node?.backendNodeId ?? 0);
      if (!backendNodeId || !described.node) continue;
      results.push(await summarizeNode(client, backendNodeId, described.node));
    }
    return results;
  });
}

interface CdpDomNode {
  nodeName?: string;
  backendNodeId?: number;
  attributes?: string[];
}

async function inspectBackendNode(
  target: BrowserTarget,
  backendNodeId: number,
): Promise<BrowserNodeSummary> {
  return withCdpClient(target, async (client) => {
    await client.command("DOM.enable");
    const described = await client.command<{ node?: CdpDomNode }>(
      "DOM.describeNode",
      {
        backendNodeId,
        depth: 0,
        pierce: true,
      },
    );
    if (!described.node)
      throw new Error(
        `BROWSER_NODE_NOT_FOUND: backend node ${backendNodeId} was not found`,
      );
    return summarizeNode(client, backendNodeId, described.node);
  });
}

async function summarizeNode(
  client: CdpClient,
  backendNodeId: number,
  node: CdpDomNode,
): Promise<BrowserNodeSummary> {
  const attributes = attributesToRecord(node.attributes ?? []);
  const resolved = await client.command<{ object?: { objectId?: string } }>(
    "DOM.resolveNode",
    {
      backendNodeId,
    },
  );
  const objectId = resolved.object?.objectId;
  let runtime: {
    text?: string;
    role?: string | null;
    visible?: boolean;
    bounds?: { x: number; y: number; width: number; height: number };
  } = {};
  if (objectId) {
    const called = await client.command<{
      result?: { value?: typeof runtime };
    }>("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration:
        "function(){const r=this.getBoundingClientRect();const s=getComputedStyle(this);return {text:String(this.innerText||this.textContent||'').replace(/\\s+/g,' ').trim().slice(0,1000),role:this.getAttribute('role')||null,visible:s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0,bounds:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}}}",
      returnByValue: true,
    });
    runtime = called.result?.value ?? {};
    await client
      .command("Runtime.releaseObject", { objectId })
      .catch(() => undefined);
  }
  return {
    nodeId: backendNodeId,
    tag: String(node.nodeName ?? "unknown").toLowerCase(),
    ...(attributes.id ? { id: attributes.id } : {}),
    classes: (attributes.class ?? "").split(/\s+/).filter(Boolean).slice(0, 20),
    attributes: Object.fromEntries(Object.entries(attributes).slice(0, 50)),
    text: String(runtime.text ?? "").slice(0, 1_000),
    ...(runtime.role ? { role: runtime.role } : {}),
    visible: runtime.visible === true,
    ...(runtime.bounds ? { bounds: runtime.bounds } : {}),
  };
}

async function computedStyle(
  target: BrowserTarget,
  backendNodeId: number,
  properties: string[],
): Promise<Record<string, string>> {
  return withCdpClient(target, async (client) => {
    await client.command("DOM.enable");
    await client.command("CSS.enable");
    await client.command("DOM.getDocument", { depth: 0 });
    const pushed = await client.command<{ nodeIds?: number[] }>(
      "DOM.pushNodesByBackendIdsToFrontend",
      { backendNodeIds: [backendNodeId] },
    );
    const nodeId = Number(pushed.nodeIds?.[0] ?? 0);
    if (!nodeId)
      throw new Error(
        `BROWSER_NODE_NOT_FOUND: backend node ${backendNodeId} was not found`,
      );
    const result = await client.command<{
      computedStyle?: Array<{ name?: string; value?: string }>;
    }>("CSS.getComputedStyleForNode", { nodeId });
    const allowed = new Set(properties.map((entry) => entry.toLowerCase()));
    return Object.fromEntries(
      (result.computedStyle ?? [])
        .filter((entry) => entry.name && allowed.has(entry.name.toLowerCase()))
        .map((entry) => [entry.name!, String(entry.value ?? "")]),
    );
  });
}

function assertSafeEvaluateExpression(expression: string): void {
  const forbidden = [
    /\bdocument\s*\.\s*cookie\b/i,
    /\bcookieStore\b/i,
    /\blocalStorage\b/i,
    /\bsessionStorage\b/i,
    /\bindexedDB\b/i,
    /\bcaches\b/i,
    /\bnavigator\s*\.\s*credentials\b/i,
  ];
  if (forbidden.some((pattern) => pattern.test(expression)))
    throw new Error(
      "BROWSER_EVALUATE_DENIED: cookie, credential, and browser-storage APIs are outside Qnector browser diagnostics scope",
    );
}

async function evaluateExpression(
  target: BrowserTarget,
  expression: string,
  awaitPromise: boolean,
  maxChars: number,
): Promise<Record<string, unknown>> {
  return withCdpClient(target, async (client) => {
    await client.command("Runtime.enable");
    const evaluated = await client.command<{
      result?: {
        type?: string;
        value?: unknown;
        description?: string;
      };
      exceptionDetails?: {
        text?: string;
        exception?: { description?: string };
      };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: false,
      throwOnSideEffect: true,
      timeout: 3_000,
    });
    if (evaluated.exceptionDetails) {
      const details =
        evaluated.exceptionDetails.exception?.description ??
        evaluated.exceptionDetails.text ??
        "JavaScript evaluation failed";
      throw new Error(`BROWSER_EVALUATE_FAILED: ${details.slice(0, 2_000)}`);
    }
    const result = evaluated.result ?? {};
    const output: Record<string, unknown> = {
      type: result.type ?? "undefined",
      ...(result.value !== undefined ? { value: result.value } : {}),
      ...(result.description
        ? { description: result.description.slice(0, 2_000) }
        : {}),
    };
    const serialized = JSON.stringify(output);
    if (Buffer.byteLength(serialized, "utf8") > maxChars)
      throw new Error(
        `BROWSER_EVALUATE_TOO_LARGE: serialized result exceeds ${maxChars} bytes`,
      );
    return output;
  });
}

interface NetworkRequestSummary {
  requestId: string;
  url: string;
  method?: string;
  resourceType?: string;
  status?: number;
  mimeType?: string;
  protocol?: string;
  fromDiskCache?: boolean;
  encodedDataLength?: number;
  failed?: boolean;
  canceled?: boolean;
  errorText?: string;
  durationMs?: number;
}

async function collectNetworkRequests(
  target: BrowserTarget,
  idleMs: number,
  maxResults: number,
  reloadPage: boolean,
): Promise<{ requests: NetworkRequestSummary[]; truncated: boolean }> {
  const eventLimit = Math.min(2_000, Math.max(20, maxResults * 5));
  const events = await collectCdpEvents(
    target,
    reloadPage
      ? ["Network.enable", "Page.enable", "Page.reload"]
      : ["Network.enable"],
    [
      "Network.requestWillBeSent",
      "Network.responseReceived",
      "Network.loadingFinished",
      "Network.loadingFailed",
    ],
    idleMs,
    eventLimit,
  );
  const entries = new Map<
    string,
    NetworkRequestSummary & { startedAt?: number; finishedAt?: number }
  >();
  for (const event of events) {
    const params = event.params ?? {};
    const requestId = String(params.requestId ?? "");
    if (!requestId) continue;
    const current = entries.get(requestId) ?? { requestId, url: "" };
    if (event.method === "Network.requestWillBeSent") {
      const request = params.request as Record<string, unknown> | undefined;
      current.url = String(request?.url ?? current.url);
      current.method = String(request?.method ?? current.method ?? "GET");
      current.resourceType = String(
        params.type ?? current.resourceType ?? "Other",
      );
      current.startedAt = finiteNumber(params.timestamp) ?? current.startedAt;
    } else if (event.method === "Network.responseReceived") {
      const response = params.response as Record<string, unknown> | undefined;
      current.url = String(response?.url ?? current.url);
      current.resourceType = String(
        params.type ?? current.resourceType ?? "Other",
      );
      current.status = finiteNumber(response?.status);
      current.mimeType = optionalString(response?.mimeType);
      current.protocol = optionalString(response?.protocol);
      if (typeof response?.fromDiskCache === "boolean")
        current.fromDiskCache = response.fromDiskCache;
    } else if (event.method === "Network.loadingFinished") {
      current.finishedAt = finiteNumber(params.timestamp) ?? current.finishedAt;
      current.encodedDataLength = finiteNumber(params.encodedDataLength);
    } else if (event.method === "Network.loadingFailed") {
      current.failed = true;
      current.finishedAt = finiteNumber(params.timestamp) ?? current.finishedAt;
      current.errorText = optionalString(params.errorText)?.slice(0, 1_000);
      if (typeof params.canceled === "boolean")
        current.canceled = params.canceled;
      current.resourceType = String(
        params.type ?? current.resourceType ?? "Other",
      );
    }
    entries.set(requestId, current);
  }
  const requests = [...entries.values()]
    .filter((entry) => entry.url)
    .map(({ startedAt, finishedAt, ...entry }) => ({
      ...entry,
      ...(startedAt !== undefined && finishedAt !== undefined
        ? {
            durationMs: Math.max(
              0,
              Math.round((finishedAt - startedAt) * 1_000),
            ),
          }
        : {}),
    }))
    .slice(0, maxResults);
  return {
    requests,
    truncated: entries.size > maxResults || events.length >= eventLimit,
  };
}

async function performanceSnapshot(
  target: BrowserTarget,
  requestedMetrics: string[],
): Promise<{
  metrics: Record<string, number>;
  navigation: Record<string, number | string> | null;
  paint: Array<{ name: string; startTime: number }>;
}> {
  return withCdpClient(target, async (client) => {
    await client.command("Performance.enable");
    const raw = await client.command<{
      metrics?: Array<{ name?: string; value?: number }>;
    }>("Performance.getMetrics");
    const requested = new Set(
      requestedMetrics.map((entry) => entry.toLowerCase()),
    );
    const metrics = Object.fromEntries(
      (raw.metrics ?? [])
        .filter(
          (entry) =>
            entry.name &&
            requested.has(entry.name.toLowerCase()) &&
            typeof entry.value === "number" &&
            Number.isFinite(entry.value),
        )
        .map((entry) => [entry.name!, entry.value!]),
    );
    const timing = await client.command<{
      result?: {
        value?: {
          navigation?: Record<string, number | string> | null;
          paint?: Array<{ name?: string; startTime?: number }>;
        };
      };
      exceptionDetails?: { text?: string };
    }>("Runtime.evaluate", {
      expression:
        "(() => { const n=performance.getEntriesByType('navigation')[0]; const nav=n?{type:n.type,duration:n.duration,domInteractive:n.domInteractive,domContentLoadedEventEnd:n.domContentLoadedEventEnd,loadEventEnd:n.loadEventEnd,transferSize:n.transferSize,encodedBodySize:n.encodedBodySize,decodedBodySize:n.decodedBodySize}:null; const paint=performance.getEntriesByType('paint').slice(0,10).map(e=>({name:e.name,startTime:e.startTime})); return {navigation:nav,paint}; })()",
      returnByValue: true,
    });
    if (timing.exceptionDetails)
      throw new Error(
        `BROWSER_PERFORMANCE_FAILED: ${timing.exceptionDetails.text ?? "performance timing evaluation failed"}`,
      );
    const value = timing.result?.value ?? {};
    return {
      metrics,
      navigation: value.navigation ?? null,
      paint: (value.paint ?? []).flatMap((entry) => {
        const name = optionalString(entry.name);
        const startTime = finiteNumber(entry.startTime);
        return name && startTime !== undefined ? [{ name, startTime }] : [];
      }),
    };
  });
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

async function listTargets(
  host: string,
  port: number,
): Promise<BrowserTarget[]> {
  const targets = await fetchJson<BrowserTarget[]>(
    `http://${formatHost(host)}:${port}/json/list`,
  );
  const filtered = targets.filter(
    (target) =>
      target.type === "page" &&
      isAllowedPageUrl(target.url) &&
      isAllowedWebSocketUrl(target.webSocketDebuggerUrl),
  );
  return filtered.map((target) => ({
    id: target.id,
    type: target.type,
    title: target.title,
    url: target.url,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
  }));
}

function chooseTarget(
  targets: BrowserTarget[],
  targetId?: string,
): BrowserTarget {
  const target = targetId
    ? targets.find((entry) => entry.id === targetId)
    : targets[0];
  if (!target)
    throw new Error(
      targetId
        ? `BROWSER_TARGET_NOT_FOUND: '${targetId}' is not an available browser page target`
        : "BROWSER_NO_TARGET: open a page in the dedicated browser profile first",
    );
  return target;
}

function isAllowedPageUrl(value: string | undefined): boolean {
  if (!value) return false;
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedWebSocketUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "ws:" || url.protocol === "wss:") &&
      isLoopbackHost(url.hostname)
    );
  } catch {
    return false;
  }
}

function isLoopbackHost(value: string): boolean {
  return LOOPBACK_HOSTS.has(value.toLowerCase()) || value === "[::1]";
}

async function fetchJson<T>(url: string): Promise<T> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } catch (error: unknown) {
    throw new Error(
      `BROWSER_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function collectCdpEvents(
  target: BrowserTarget,
  enableCommands: string[],
  eventNames: string[],
  idleMs: number,
  maxResults: number,
): Promise<CdpMessage[]> {
  return new Promise((resolve, reject) => {
    const socketUrl = target.webSocketDebuggerUrl;
    if (!socketUrl) {
      reject(
        new Error("BROWSER_TARGET_NO_WEBSOCKET: target has no CDP endpoint"),
      );
      return;
    }
    const socket = new WebSocket(socketUrl);
    const events: CdpMessage[] = [];
    let nextId = 1;
    let timer: NodeJS.Timeout | undefined = setTimeout(
      () => finish(new Error("BROWSER_CDP_TIMEOUT: connection timed out")),
      5_000,
    );
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(events);
    };
    const arm = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(), idleMs);
    };
    socket.once("open", () => {
      for (const method of enableCommands)
        socket.send(JSON.stringify({ id: nextId++, method }));
      arm();
    });
    socket.on("message", (payload) => {
      try {
        const message = JSON.parse(payload.toString()) as CdpMessage;
        if (message.method && eventNames.includes(message.method)) {
          events.push(message);
          if (events.length >= maxResults) finish();
          else arm();
        }
      } catch (error: unknown) {
        finish(
          new Error(
            `BROWSER_PROTOCOL_ERROR: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
    socket.once("error", (error) =>
      finish(new Error(`BROWSER_CDP_ERROR: ${error.message}`)),
    );
    socket.once("close", () => {
      if (!settled) finish();
    });
  });
}

class CdpClient {
  private socket?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  public constructor(private readonly target: BrowserTarget) {}

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socketUrl = this.target.webSocketDebuggerUrl;
      if (!socketUrl) {
        reject(
          new Error("BROWSER_TARGET_NO_WEBSOCKET: target has no CDP endpoint"),
        );
        return;
      }
      const socket = new WebSocket(socketUrl);
      this.socket = socket;
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("BROWSER_CDP_TIMEOUT: connection timed out"));
      }, 5_000);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on("message", (payload) => this.handleMessage(payload.toString()));
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`BROWSER_CDP_ERROR: ${error.message}`));
        this.rejectAll(new Error(`BROWSER_CDP_ERROR: ${error.message}`));
      });
      socket.once("close", () =>
        this.rejectAll(
          new Error("BROWSER_TARGET_GONE: CDP target connection closed"),
        ),
      );
    });
  }

  public command<T = Record<string, never>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(
        new Error("BROWSER_CDP_ERROR: CDP connection is not open"),
      );
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`BROWSER_CDP_TIMEOUT: ${method} timed out`));
      }, 5_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      socket.send(
        JSON.stringify({ id, method, ...(params ? { params } : {}) }),
      );
    });
  }

  public close(): void {
    this.socket?.close();
    this.socket = undefined;
  }

  private handleMessage(payload: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(payload) as CdpMessage;
    } catch (error: unknown) {
      this.rejectAll(
        new Error(
          `BROWSER_PROTOCOL_ERROR: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error)
      pending.reject(
        new Error(
          `BROWSER_CDP_COMMAND_FAILED: ${message.error.message ?? "CDP command failed"}`,
        ),
      );
    else pending.resolve(message.result ?? {});
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function withCdpClient<T>(
  target: BrowserTarget,
  work: (client: CdpClient) => Promise<T>,
): Promise<T> {
  const client = new CdpClient(target);
  await client.connect();
  try {
    return await work(client);
  } finally {
    client.close();
  }
}

function attributesToRecord(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index + 1 < values.length; index += 2)
    result[values[index]!] = values[index + 1]!;
  return result;
}

function stringArrayInput(
  input: Record<string, unknown>,
  key: string,
  fallback: string[],
  max: number,
): string[] {
  const value = input[key];
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`INVALID_INPUT: ${key} must be an array of strings`);
  const cleaned = value
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, max);
  if (cleaned.length === 0)
    throw new Error(`INVALID_INPUT: ${key} must contain at least one property`);
  return [...new Set(cleaned)];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function formatHost(host: string): string {
  return host === "::1" ? `[${host}]` : host;
}
