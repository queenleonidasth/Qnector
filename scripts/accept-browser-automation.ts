import { createServer } from "node:http";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { defaultConfig } from "../packages/core/src/config.js";
import { QnectorRuntime } from "../packages/mcp-server/src/server.js";

const root = await mkdtemp(path.join(os.tmpdir(), "qnector-browser-auto-"));
const profileRoot = path.join(root, "profiles");
process.env.QNECTOR_BROWSER_PROFILE_ROOT = profileRoot;
const uploadPath = path.join(root, "upload.txt");
await writeFile(uploadPath, "Qnector browser upload acceptance\n", "utf8");

const webPort = await freePort();
const devtoolsPort = await freePort();
const baseUrl = `http://127.0.0.1:${webPort}`;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", baseUrl);
  if (url.pathname === "/api/save") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, received: body.length }));
    });
    return;
  }
  if (url.pathname === "/page2") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><html><head><title>Page Two</title></head><body><h1>Browser Page Two</h1><a href="/">Home</a></body></html>`,
    );
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html>
<head><title>Qnector Browser Automation</title></head>
<body>
  <main>
    <h1>Product Editor</h1>
    <label>Product Name <input id="product-name" name="productName" /></label>
    <label>SKU <input id="sku" name="sku" placeholder="SKU code" /></label>
    <label>Branch
      <select id="branch" name="branch">
        <option value="Bangkok">Bangkok</option>
        <option value="ChiangMai">Chiang Mai</option>
      </select>
    </label>
    <label><input id="gift" type="checkbox" /> Include Gift</label>
    <label>Attachment <input id="file" type="file" /></label>
    <button id="save" data-testid="save-product">Save Product</button>
    <div id="status" role="status">Idle</div>
  </main>
  <script>
    document.querySelector('#save').addEventListener('click', async () => {
      const name = document.querySelector('#product-name').value;
      const sku = document.querySelector('#sku').value;
      const branch = document.querySelector('#branch').value;
      const gift = document.querySelector('#gift').checked;
      console.log('save-product', { name, sku, branch, gift });
      const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, sku, branch, gift })
      });
      if (!response.ok) throw new Error('save failed');
      document.querySelector('#status').textContent = 'Saved ' + name + ' / ' + sku + ' / ' + branch + ' / gift=' + gift;
    });
  </script>
</body>
</html>`);
});

await new Promise<void>((resolve) =>
  server.listen(webPort, "127.0.0.1", resolve),
);
const config = {
  ...defaultConfig(root),
  transport: { mode: "local-only" as const },
};
const runtime = new QnectorRuntime({ config });
const call = (action: string, input: Record<string, unknown> = {}) =>
  runtime.registry.call("browser", runtime.context(), { action, ...input });
const checks: Record<string, unknown> = {};
const browserSchema = runtime.registry
  .list()
  .find((entry) => entry.name === "browser");
const browserSchemaJson = JSON.stringify(browserSchema ?? {});
for (const action of [
  "navigate",
  "find",
  "click",
  "fill",
  "upload_file",
  "open_url",
  "profile_reset",
])
  assert(
    browserSchemaJson.includes(`\"${action}\"`),
    `browser schema missing ${action}`,
  );
checks.schema = "P19 browser actions advertised";

try {
  const launch = await call("launch", {
    browser: "auto",
    port: devtoolsPort,
    url: baseUrl,
    profile: "web-dev-acceptance",
    persistentProfile: true,
  });
  assert(launch.ok, "managed browser launch failed");
  await delay(600);
  const launchData = unwrap(launch);
  assert(
    launchData.persistentProfile === true,
    "persistent profile not enabled",
  );
  assert(
    String(launchData.profileName) === "web-dev-acceptance",
    "persistent profile name missing",
  );
  checks.profile = {
    profileName: launchData.profileName,
    persistentProfile: launchData.persistentProfile,
  };

  const targets = await call("tabs", { port: devtoolsPort });
  assert(targets.ok, "tabs failed");
  const targetList = (unwrap(targets).targets ?? []) as Array<
    Record<string, unknown>
  >;
  const home = targetList.find((entry) =>
    String(entry.url).startsWith(baseUrl),
  );
  assert(home, "home target missing");
  const targetId = String(home.id);

  const find = await call("find", {
    port: devtoolsPort,
    targetId,
    role: "button",
    name: "Save Product",
  });
  assert(find.ok, "role/name browser find failed");
  assert(
    JSON.stringify(find).includes('\"id\":\"save\"') &&
      JSON.stringify(find).includes("Save Product"),
    "find did not locate save button",
  );

  const fillName = await call("fill", {
    port: devtoolsPort,
    targetId,
    label: "Product Name",
    value: "Qnector Web Item",
  });
  assert(fillName.ok, "fill by label failed");

  const typeSku = await call("type", {
    port: devtoolsPort,
    targetId,
    placeholder: "SKU code",
    value: "QN-001",
    delayMs: 5,
  });
  assert(typeSku.ok, "type by placeholder failed");

  const select = await call("select", {
    port: devtoolsPort,
    targetId,
    label: "Branch",
    value: "ChiangMai",
  });
  assert(select.ok, "select failed");

  const check = await call("check", {
    port: devtoolsPort,
    targetId,
    label: "Include Gift",
  });
  assert(check.ok, "check failed");

  const upload = await call("upload_file", {
    port: devtoolsPort,
    targetId,
    selector: "#file",
    paths: [uploadPath],
  });
  assert(upload.ok, "upload_file failed");

  const press = await call("press", {
    port: devtoolsPort,
    targetId,
    placeholder: "SKU code",
    key: "End",
    observeMs: 50,
  });
  assert(press.ok, "press failed");

  const click = await call("click", {
    port: devtoolsPort,
    targetId,
    testId: "save-product",
    observeMs: 900,
  });
  assert(click.ok, "click failed");
  const clickJson = JSON.stringify(click);
  assert(
    clickJson.includes("/api/save"),
    "click observation missed save API response",
  );
  assert(
    clickJson.includes('"status":200'),
    "click observation missed HTTP 200",
  );
  assert(
    clickJson.includes("save-product"),
    "click observation missed console output",
  );

  const wait = await call("wait", {
    port: devtoolsPort,
    targetId,
    selector: "#status",
    condition: "text",
    text: "Saved Qnector Web Item",
    timeoutMs: 5_000,
  });
  assert(wait.ok, "wait for status text failed");

  const getText = await call("get_text", {
    port: devtoolsPort,
    targetId,
    selector: "#status",
  });
  assert(getText.ok, "get_text failed");
  const text = String(unwrap(getText).text ?? "");
  assert(text.includes("QN-001"), "saved status missing SKU");
  assert(text.includes("ChiangMai"), "saved status missing branch");
  assert(text.includes("gift=true"), "saved status missing checkbox state");

  const getValue = await call("get_value", {
    port: devtoolsPort,
    targetId,
    label: "Product Name",
  });
  assert(getValue.ok, "get_value failed");
  assert(
    String(unwrap(getValue).value) === "Qnector Web Item",
    "get_value returned wrong value",
  );

  const attributes = await call("get_attributes", {
    port: devtoolsPort,
    targetId,
    testId: "save-product",
  });
  assert(attributes.ok, "get_attributes failed");
  assert(
    JSON.stringify(attributes).includes('"data-testid":"save-product"'),
    "button attributes missing test id",
  );

  const navigate = await call("navigate", {
    port: devtoolsPort,
    targetId,
    url: `${baseUrl}/page2`,
    waitUntil: "domcontentloaded",
  });
  assert(navigate.ok, "navigate failed");
  assert(
    JSON.stringify(navigate).includes("Browser Page Two") ||
      JSON.stringify(navigate).includes("/page2"),
    "navigate did not reach page2",
  );

  const back = await call("back", {
    port: devtoolsPort,
    targetId,
    waitUntil: "domcontentloaded",
  });
  assert(back.ok, `back failed: ${JSON.stringify(back)}`);
  assert(
    String(unwrap(back).url).startsWith(baseUrl),
    "back did not return home",
  );

  const forward = await call("forward", {
    port: devtoolsPort,
    targetId,
    waitUntil: "domcontentloaded",
  });
  assert(forward.ok, "forward failed");
  assert(
    String(unwrap(forward).url).includes("/page2"),
    "forward did not return page2",
  );

  const newTab = await call("new_tab", {
    port: devtoolsPort,
    url: baseUrl,
  });
  assert(newTab.ok, "new_tab failed");
  const newTargetId = String(unwrap(newTab).targetId);
  assert(newTargetId, "new tab target id missing");
  const activate = await call("activate_tab", {
    port: devtoolsPort,
    targetId: newTargetId,
  });
  assert(activate.ok, "activate_tab failed");
  const closeTab = await call("close_tab", {
    port: devtoolsPort,
    targetId: newTargetId,
  });
  assert(closeTab.ok, "close_tab failed");

  const external = await call("open_url", {
    url: "https://example.com/",
  });
  assert(external.ok, "open_url rejected a normal external http/https URL");
  await delay(250);
  const externalTargets = await call("targets", { port: devtoolsPort });
  assert(externalTargets.ok, "targets after external open failed");
  assert(
    JSON.stringify(externalTargets).includes("example.com"),
    "external web target was still filtered out",
  );

  checks.automation = {
    find: true,
    fill: true,
    type: true,
    select: true,
    check: true,
    upload: true,
    press: true,
    clickObservedApiAndConsole: true,
    wait: true,
    read: true,
    navigateHistory: true,
    tabs: true,
    externalUrl: true,
  };

  const close = await call("close");
  assert(close.ok, "browser close failed");
  const profileDir = String(unwrap(close).profileDir ?? "");
  assert(profileDir, "persistent profile path missing after close");
  assert(await exists(profileDir), "persistent profile was deleted on close");
  const reset = await call("profile_reset", { profile: "web-dev-acceptance" });
  assert(reset.ok, "profile_reset failed");
  assert(!(await exists(profileDir)), "profile_reset did not remove profile");
  checks.profilePersistence = true;

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await runtime.browserRuntime.close().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.QNECTOR_BROWSER_PROFILE_ROOT;
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

function unwrap(result: { data?: unknown }): Record<string, any> {
  const outer = (result.data ?? {}) as Record<string, any>;
  return (outer.data ?? outer) as Record<string, any>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}
