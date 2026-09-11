$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cssPath = (Resolve-Path (Join-Path $projectRoot "apps\desktop\src\renderer\skill-manager.css")).Path.Replace("\", "/")
$electron = Join-Path $projectRoot "node_modules\.bin\electron.cmd"
if (-not (Test-Path -LiteralPath $electron)) { throw "Electron launcher is missing: $electron" }

$htmlPath = Join-Path $env:TEMP "qnector-skill-layout-$([Guid]::NewGuid().ToString('N')).html"
$mainPath = Join-Path $env:TEMP "qnector-skill-layout-$([Guid]::NewGuid().ToString('N')).cjs"

try {
  $rows = (1..8 | ForEach-Object {
    "<div class='skills-discover-row'><span class='skill-row-icon'>CU</span><span class='skills-discover-copy'><strong>computer-vision-opencv-long-name-$_</strong><small>owner/repository-with-long-source-$_</small><em>143.8K installs</em></span><button class='skills-secondary'>Install</button></div>"
  }) -join "`n"

  @"
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="file:///$cssPath">
  <style>
    :root { --font-sans: Arial, sans-serif; --gold-light: #f5da90; --gold-primary: #e6ba50; --text-main: #eee; --text-muted: #999; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: #111; }
    .host { padding: 14px; }
  </style>
</head>
<body>
  <div class="host">
    <section class="skills-modal skills-discover-modal">
      <div class="skills-discover-results">$rows</div>
    </section>
  </div>
</body>
</html>
"@ | Set-Content -LiteralPath $htmlPath -Encoding UTF8

  @'
const { app, BrowserWindow } = require("electron");
const { pathToFileURL } = require("node:url");
const html = process.argv[2];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 435,
    height: 900,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { sandbox: true },
  });
  await win.loadURL(pathToFileURL(html).href);

  for (const width of [435, 700]) {
    win.setContentSize(width, 900);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = await win.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('.skills-discover-results');
      const rows = [...document.querySelectorAll('.skills-discover-row')];
      const data = rows.map((row) => {
        const rowRect = row.getBoundingClientRect();
        const children = [...row.children].map((child) => child.getBoundingClientRect());
        return {
          top: rowRect.top,
          bottom: rowRect.bottom,
          minChildTop: Math.min(...children.map((child) => child.top)),
          maxChildBottom: Math.max(...children.map((child) => child.bottom)),
          button: { left: children[2].left, right: children[2].right },
          copy: { left: children[1].left, right: children[1].right },
        };
      });
      return {
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        overflowY: getComputedStyle(list).overflowY,
        rows: data,
      };
    })()`);

    let ok = result.scrollHeight > result.clientHeight && ["auto", "scroll"].includes(result.overflowY);
    for (let index = 0; index < result.rows.length; index += 1) {
      const row = result.rows[index];
      ok = ok && row.minChildTop >= row.top - 0.5 && row.maxChildBottom <= row.bottom + 0.5;
      if (index < result.rows.length - 1) ok = ok && row.bottom <= result.rows[index + 1].top + 0.5;
      if (width <= 460) ok = ok && row.button.left >= row.copy.left - 0.5 && row.button.right <= row.copy.right + 0.5;
      else ok = ok && row.button.left >= row.copy.right - 0.5;
    }
    if (!ok) fail(`Skill discovery layout regression at ${width}px`);
  }

  win.destroy();
  await app.quit();
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});
'@ | Set-Content -LiteralPath $mainPath -Encoding UTF8

  & $electron $mainPath $htmlPath
  if ($LASTEXITCODE -ne 0) { throw "Skill discovery layout acceptance failed" }
  Write-Output "Skill discovery layout acceptance passed at 435px and 700px."
} finally {
  Remove-Item -LiteralPath $htmlPath, $mainPath -Force -ErrorAction SilentlyContinue
}
