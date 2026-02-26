import { execFile, spawn, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";

export function createPackagesViewProvider(findPiBinary: () => string): vscode.WebviewViewProvider {
  return {
    resolveWebviewView(webviewView: vscode.WebviewView) {
      webviewView.webview.options = { enableScripts: true };
      webviewView.webview.html = getPackagesHtml();
      let activeProcess: ChildProcess | undefined;

      const refreshInstalled = () => {
        const bin = findPiBinary();
        execFile(bin, ["list"], (_err, stdout) => {
          const packages = parseInstalledPackages(stdout || "");
          webviewView.webview.postMessage({ type: "installed", packages });
        });
      };

      const runCommand = (args: string[]) => {
        const bin = findPiBinary();
        webviewView.webview.postMessage({ type: "loading", loading: true, output: "" });
        const proc = spawn(bin, args);
        activeProcess = proc;
        const onData = (chunk: Buffer) => {
          webviewView.webview.postMessage({ type: "output", text: chunk.toString() });
        };
        proc.stdout?.on("data", onData);
        proc.stderr?.on("data", onData);
        proc.on("close", () => {
          activeProcess = undefined;
          webviewView.webview.postMessage({ type: "loading", loading: false });
          refreshInstalled();
        });
      };

      refreshInstalled();
      webviewView.webview.onDidReceiveMessage((msg) => {
        if (msg.type === "install" && msg.package) {
          runCommand(["install", msg.package]);
        } else if (msg.type === "uninstall" && msg.package) {
          runCommand(["remove", msg.package]);
        } else if (msg.type === "cancel") {
          activeProcess?.kill();
        } else if (msg.type === "refresh") {
          refreshInstalled();
        }
      });
    },
  };
}

function parseInstalledPackages(output: string): { source: string; path: string }[] {
  const packages: { source: string; path: string }[] = [];
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("npm:") || trimmed.startsWith("github:") || trimmed.startsWith("http")) {
      const pathLine = lines[i + 1]?.trim() || "";
      packages.push({ source: trimmed, path: pathLine });
    }
  }
  return packages;
}

function getPackagesHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html style="height:100%;margin:0;padding:0">
<head><style>
* { box-sizing: border-box; }
body { height:100%; margin:0; padding:0; font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); display:flex; flex-direction:column; overflow-x:hidden; }
* { word-wrap:break-word; overflow-wrap:break-word; }
.search-bar { padding:8px; display:flex; gap:4px; flex-shrink:0; }
.search-bar input { flex:1; min-width:0; padding:4px 8px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent); border-radius:4px; font-size:12px; outline:none; }
.search-bar button { padding:4px 10px; cursor:pointer; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:4px; font-size:12px; white-space:nowrap; }
.search-bar button:hover { background:var(--vscode-button-hoverBackground); }
.pkg-list { flex:1; overflow-y:auto; padding:0 8px 8px; }
.pkg-card { padding:10px; margin-bottom:6px; background:var(--vscode-editor-background); border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,transparent)); border-radius:6px; }
.pkg-name { font-weight:600; margin-bottom:2px; display:flex; align-items:center; gap:6px; }
.pkg-name a { color:var(--vscode-textLink-foreground); text-decoration:none; }
.pkg-name a:hover { text-decoration:underline; }
.pkg-desc { font-size:12px; opacity:0.8; margin-bottom:6px; }
.pkg-meta { font-size:11px; opacity:0.6; margin-bottom:6px; }
.pkg-meta span + span::before { content:" · "; }
.pkg-install-bar { display:flex; gap:4px; align-items:center; justify-content:flex-end; }
.pkg-install-bar button { padding:3px 10px; cursor:pointer; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:4px; font-size:11px; }
.pkg-install-bar button:hover { background:var(--vscode-button-hoverBackground); }
.status { padding:20px; text-align:center; opacity:0.6; }
.installed-item { display:flex; align-items:center; justify-content:space-between; padding:4px 0; font-size:12px; }
.installed-item code { font-size:11px; opacity:0.9; word-break:break-all; }
.uninstall-btn { padding:2px 8px; cursor:pointer; background:var(--vscode-inputValidation-errorBackground,#d32f2f); color:#fff; border:none; border-radius:3px; font-size:10px; }
.uninstall-btn:hover { background:var(--vscode-inputValidation-errorBackground,#d32f2f); color:#fff; }
.pkg-labels { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; }
.pi-label { display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:500; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); }
.pkg-media { margin:6px 0; border-radius:4px; overflow:hidden; }
.pkg-media img, .pkg-media video { width:100%; display:block; border-radius:4px; }
</style></head>
<body>
<div class="search-bar">
  <input id="search" type="text" placeholder="Search packages..." />
  <button id="search-btn">Search</button>
</div>
<div id="installed-section" style="display:none;padding:8px;border-bottom:1px solid var(--vscode-widget-border,var(--vscode-panel-border,transparent))">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <strong style="font-size:12px">Installed</strong>
    <button onclick="vscode.postMessage({type:'refresh'})" style="padding:2px 8px;cursor:pointer;background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-widget-border,transparent);border-radius:3px;font-size:11px;opacity:0.7">↻ Refresh</button>
  </div>
  <div id="installed-list"></div>
</div>
<div id="loading-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;flex-direction:column;align-items:center;justify-content:center;gap:8px;font-size:13px;color:var(--vscode-foreground)">
  <strong>Working...</strong>
  <pre id="output-log" style="max-height:200px;width:80%;overflow-y:auto;background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border,transparent);border-radius:4px;padding:6px;font-size:11px;margin:0;white-space:pre-wrap;word-break:break-all"></pre>
  <button onclick="vscode.postMessage({type:'cancel'})" style="padding:4px 12px;cursor:pointer;background:var(--vscode-inputValidation-errorBackground,#d32f2f);color:#fff;border:none;border-radius:4px;font-size:12px">Cancel</button>
</div>
<div id="list" class="pkg-list"><div class="status">Loading...</div></div>
<div style="padding:4px 8px 8px;text-align:right;flex-shrink:0"><a href="https://shittycodingagent.ai/packages" target="_blank" style="font-size:11px;color:var(--vscode-textLink-foreground);text-decoration:none;opacity:0.8">Browse packages ↗</a></div>
<script>
const vscode = acquireVsCodeApi();
const searchInput = document.getElementById('search');
const searchBtn = document.getElementById('search-btn');
const list = document.getElementById('list');
let allPackages = [];
let installedSet = new Set();

async function fetchPackages() {
  list.innerHTML = '<div class="status">Loading...</div>';
  try {
    const res = await fetch('https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250');
    const data = await res.json();
    allPackages = (data.objects || []).map(o => ({
      name: o.package.name,
      description: o.package.description || '',
      version: o.package.version || '',
      author: o.package.publisher?.username || o.package.author?.name || '',
      keywords: (o.package.keywords || []).join(' '),
      npm: o.package.links?.npm || ('https://www.npmjs.com/package/' + o.package.name),
      repo: o.package.links?.repository || '',
      piLabels: [],
      image: '',
      video: '',
    }));
    render('');
    // Fetch full package.json for each to detect pi section
    await Promise.all(allPackages.map(async (p) => {
      try {
        const r = await fetch('https://registry.npmjs.org/' + encodeURIComponent(p.name) + '/latest');
        const pkg = await r.json();
        if (pkg.pi && typeof pkg.pi === 'object') {
          const labels = [];
          if (pkg.pi.extensions?.length) labels.push('extensions');
          if (pkg.pi.skills?.length) labels.push('skills');
          if (pkg.pi.prompts?.length) labels.push('prompts');
          if (pkg.pi.themes?.length) labels.push('themes');
          p.piLabels = labels;
          if (pkg.pi.image) p.image = pkg.pi.image;
          if (pkg.pi.video) p.video = pkg.pi.video;
        }
      } catch {}
    }));
    render(searchInput.value.trim());
  } catch (e) {
    list.innerHTML = '<div class="status">Failed to load packages</div>';
  }
}

function render(query) {
  const q = query.toLowerCase();
  const filtered = q ? allPackages.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.keywords.toLowerCase().includes(q)
  ) : allPackages;

  if (!filtered.length) {
    list.innerHTML = '<div class="status">No packages found</div>';
    return;
  }

  list.innerHTML = filtered.map(p => {
    const repoLink = p.repo ? '<a href="' + p.repo + '" target="_blank" style="font-size:11px;color:var(--vscode-textLink-foreground)">repo</a>' : '';
    const labels = (p.piLabels || []).length ? '<div class="pkg-labels">' + p.piLabels.map(l => '<span class="pi-label">' + esc(l) + '</span>').join(' ') + '</div>' : '';
    const media = p.video
      ? '<div class="pkg-media"><video src="' + esc(p.video) + '" controls muted playsinline preload="metadata"></video></div>'
      : p.image
        ? '<div class="pkg-media"><img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" /></div>'
        : '';
    return '<div class="pkg-card">' +
      '<div class="pkg-name"><a href="' + p.npm + '" target="_blank">' + esc(p.name) + '</a></div>' + labels +
      media +
      '<div class="pkg-desc">' + esc(p.description) + '</div>' +
      '<div class="pkg-meta"><span>v' + esc(p.version) + '</span>' + (p.author ? '<span>' + esc(p.author) + '</span>' : '') + '</div>' +
      '<div class="pkg-install-bar">' +
        (installedSet.has('npm:' + p.name)
          ? '<button class="uninstall-btn" onclick="uninstall(\\'npm:' + esc(p.name) + '\\')">Uninstall</button>'
          : '<button onclick="install(\\'npm:' + esc(p.name) + '\\')">Install</button>') +
      '</div>' +
    '</div>';
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function install(pkg) {
  vscode.postMessage({ type: 'install', package: pkg });
}

searchBtn.addEventListener('click', () => render(searchInput.value.trim()));
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') render(searchInput.value.trim()); });

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'loading') {
    const overlay = document.getElementById('loading-overlay');
    if (msg.loading) {
      document.getElementById('output-log').textContent = '';
    }
    overlay.style.display = msg.loading ? 'flex' : 'none';
    return;
  }
  if (msg.type === 'output') {
    const log = document.getElementById('output-log');
    log.textContent += msg.text;
    log.scrollTop = log.scrollHeight;
    return;
  }
  if (msg.type === 'installed') {
    const section = document.getElementById('installed-section');
    const container = document.getElementById('installed-list');
    if (!msg.packages || !msg.packages.length) {
      installedSet = new Set();
      render(searchInput.value.trim());
      section.style.display = 'none';
      return;
    }
    installedSet = new Set(msg.packages.map(p => p.source));
    render(searchInput.value.trim());
    section.style.display = 'block';
    container.innerHTML = msg.packages.map(p =>
      '<div class="installed-item">' +
        '<code>' + esc(p.source) + '</code>' +
        '<button class="uninstall-btn" onclick="uninstall(\\'' + esc(p.source) + '\\')">Uninstall</button>' +
      '</div>'
    ).join('');
  }
});

function uninstall(pkg) {
  vscode.postMessage({ type: 'uninstall', package: pkg });
}

fetchPackages();
</script>
</body></html>`;
}
