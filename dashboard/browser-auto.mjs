import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const BRIDGE = "http://127.0.0.1:8767";
const CDP = "http://127.0.0.1:9222/json/list";

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function fetchJson(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function safeUrl(value) {
  try { return new URL(String(value || "")); } catch { return null; }
}

function normalizeHost(value) {
  const u = safeUrl(value);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "") : "";
}

function shortText(value, max = 120) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function moduleLabel(id) {
  return ({ browser: "Browser", github: "GitHub", crm: "CRM", deploy: "Deploy", elama: "eLama", direct: "Direct" })[id] || id;
}

export function createBrowserAutoController({ root, paths }) {
  const settingsFile = path.join(root, "config", "dashboard-auto.json");
  const logFile = path.join(root, "logs", "auto-browser.log");
  let timer = null;
  let inFlight = false;
  let lastSignature = "";
  const lastRun = new Map();
  const runtimes = {};
  let snapshot = {
    enabled: true,
    autoRunReadOnly: true,
    pollMs: 3000,
    cooldownMs: 15000,
    bridgeOnline: false,
    cdpOnline: false,
    tabs: [],
    recognizedTabs: [],
    activeModules: [],
    moduleReasons: {},
    currentTab: null,
    runtimes,
    updatedAt: "",
    summary: "Автоконтекст запускается"
  };

  async function ensureSettings() {
    const defaults = { enabled: true, autoRunReadOnly: true, pollMs: 3000, cooldownMs: 15000 };
    const current = await readJson(settingsFile, null);
    if (!current) {
      await fs.writeFile(settingsFile, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
      return defaults;
    }
    return { ...defaults, ...current };
  }

  async function log(line) {
    await fs.mkdir(path.dirname(logFile), { recursive: true }).catch(() => {});
    await fs.appendFile(logFile, `${new Date().toISOString()} | ${line}\n`, "utf8").catch(() => {});
  }

  async function bridgeTabs() {
    try {
      const status = await fetchJson(`${BRIDGE}/api/status`, {}, 1800);
      const online = Boolean(status?.ok) && (status.heartbeat_age_ms == null || status.heartbeat_age_ms < 12000);
      if (!online) return { online: false, tabs: [] };
      const result = await fetchJson(`${BRIDGE}/api/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "tabs" })
      }, 5000);
      const tabs = Array.isArray(result?.result) ? result.result : [];
      return { online: true, tabs: tabs.map(t => ({
        id: `bridge:${t.tab_id}`,
        nativeId: t.tab_id,
        source: "edge-bridge",
        sourceLabel: "Edge personal",
        title: t.title || "",
        url: t.url || "",
        active: Boolean(t.active),
        focused: Boolean(t.window_focused),
        pinned: Boolean(t.pinned)
      })) };
    } catch { return { online: false, tabs: [] }; }
  }

  async function cdpTabs() {
    try {
      const rows = await fetchJson(CDP, {}, 1800);
      const tabs = (Array.isArray(rows) ? rows : []).filter(t => t.type === "page" && t.url && !String(t.url).startsWith("chrome-extension://"));
      return { online: true, tabs: tabs.map(t => ({
        id: `cdp:${t.id}`,
        nativeId: t.id,
        source: "cdp",
        sourceLabel: "Edge MCP",
        title: t.title || "",
        url: t.url || "",
        active: false,
        focused: false,
        pinned: false
      })) };
    } catch { return { online: false, tabs: [] }; }
  }

  async function foregroundEdgeTitle() {
    const ps = [
      "-NoProfile", "-Command",
      "Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class FG { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid); }\n'@; $h=[FG]::GetForegroundWindow(); [uint32]$x=0; [void][FG]::GetWindowThreadProcessId($h,[ref]$x); $p=Get-Process -Id $x -ErrorAction SilentlyContinue; if($p -and $p.ProcessName -eq 'msedge'){ $p.MainWindowTitle }"
    ];
    try { return String((await execFileAsync("powershell.exe", ps, { cwd: root, timeout: 2500 })).stdout || "").trim(); }
    catch { return ""; }
  }

  function matchesConfigHost(tabHost, candidate) {
    const host = normalizeHost(candidate);
    return Boolean(host && tabHost && (tabHost === host || tabHost.endsWith(`.${host}`) || host.endsWith(`.${tabHost}`)));
  }

  function classifyTab(tab, configs) {
    const host = normalizeHost(tab.url);
    const low = `${tab.title} ${tab.url}`.toLowerCase();
    const modules = [];
    if (!tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) modules.push("browser");
    if (host === "github.com") modules.push("github");
    if (host === "elama.ru" || host.endsWith(".elama.ru")) modules.push("elama");
    if (host === "direct.yandex.ru" || host.endsWith(".direct.yandex.ru") || low.includes("яндекс директ")) modules.push("direct");
    const crmCandidates = [configs.crm?.apiUrl, configs.crm?.healthUrl].filter(Boolean);
    if (crmCandidates.some(c => matchesConfigHost(host, c)) || low.includes("/projects/graduation-albums/leads") || low.includes("crm")) modules.push("crm");
    const sites = Array.isArray(configs.deploy?.sites) ? configs.deploy.sites : [];
    if (sites.some(s => matchesConfigHost(host, s.site))) modules.push("deploy");
    return [...new Set(modules)];
  }

  function markForeground(tabs, foregroundTitle) {
    if (!foregroundTitle) return tabs;
    const low = foregroundTitle.toLowerCase();
    let best = null;
    for (const tab of tabs) {
      const title = String(tab.title || "").toLowerCase();
      if (!title) continue;
      const score = low.includes(title) ? title.length : (title.includes(low) ? low.length : 0);
      if (score && (!best || score > best.score)) best = { tab, score };
    }
    if (best) { best.tab.focused = true; best.tab.active = true; }
    return tabs;
  }

  async function bridgeRead(tab, maxChars = 5000) {
    if (!tab || tab.source !== "edge-bridge" || !Number.isFinite(Number(tab.nativeId))) return null;
    try {
      const result = await fetchJson(`${BRIDGE}/api/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "read", tab_id: Number(tab.nativeId), max_chars: maxChars })
      }, 5500);
      return result?.result || null;
    } catch { return null; }
  }

  async function gitCheckForTab(tab, githubRegistry) {
    const u = safeUrl(tab?.url);
    const parts = u?.pathname?.split("/").filter(Boolean) || [];
    const repo = parts.length >= 2 ? `${parts[0]}/${parts[1]}`.toLowerCase() : "";
    const projects = Array.isArray(githubRegistry?.projects) ? githubRegistry.projects : [];
    const match = projects.find(p => String(p.remote || "").toLowerCase().includes(repo));
    if (!match?.path) return { detected: true, repository: repo || "unknown", localProject: null };
    try {
      const r = await execFileAsync("git", ["-C", match.path, "status", "--short", "--branch"], { cwd: root, timeout: 5000 });
      return { detected: true, repository: repo, localProject: match.name || path.basename(match.path), status: shortText(r.stdout, 260) };
    } catch (e) { return { detected: true, repository: repo, localProject: match.name || path.basename(match.path), error: shortText(e.message) }; }
  }

  async function httpProbe(url) {
    if (!url) return { configured: false };
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const r = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
      clearTimeout(timer);
      return { configured: true, ok: r.status >= 200 && r.status < 500, status: r.status, timeMs: Date.now() - started };
    } catch (e) { return { configured: true, ok: false, error: shortText(e.message), timeMs: Date.now() - started }; }
  }

  async function runModule(moduleId, reason = "auto", tab = null, force = false) {
    const settings = await ensureSettings();
    const now = Date.now();
    const previous = lastRun.get(moduleId) || 0;
    if (!force && now - previous < Number(settings.cooldownMs || 15000)) return runtimes[moduleId] || null;
    lastRun.set(moduleId, now);
    runtimes[moduleId] = { module: moduleId, label: moduleLabel(moduleId), status: "running", reason, startedAt: new Date().toISOString(), finishedAt: "", result: null, error: "" };
    try {
      const [crm, deploy, githubRegistry] = await Promise.all([
        readJson(paths.crm, {}), readJson(paths.deploy, { sites: [] }), readJson(paths.githubRegistry, { projects: [] })
      ]);
      let result = { detected: true };
      if (moduleId === "browser") result = { detected: true, tabs: snapshot.tabs.length, bridgeOnline: snapshot.bridgeOnline, cdpOnline: snapshot.cdpOnline };
      else if (moduleId === "github") result = await gitCheckForTab(tab, githubRegistry);
      else if (moduleId === "crm") {
        const url = crm.healthUrl || crm.apiUrl || "";
        result = url ? await httpProbe(url) : { detected: true, page: tab ? { title: tab.title, url: tab.url } : null, note: "CRM page detected; API URL is not configured" };
      } else if (moduleId === "deploy") {
        const sites = Array.isArray(deploy.sites) ? deploy.sites : [];
        const host = normalizeHost(tab?.url);
        const site = sites.find(s => matchesConfigHost(host, s.site));
        result = site?.site ? { site: site.site, ...(await httpProbe(site.site)) } : { detected: true, page: tab?.url || "" };
      } else if (moduleId === "elama" || moduleId === "direct") {
        const page = await bridgeRead(tab, 4500);
        result = page ? { detected: true, readable: true, title: page.title, url: page.url, textPreview: shortText(page.text, 320) } : { detected: true, readable: false, title: tab?.title || "", url: tab?.url || "", source: tab?.source || "" };
      }
      runtimes[moduleId] = { ...runtimes[moduleId], status: result?.ok === false ? "warning" : "ok", finishedAt: new Date().toISOString(), result };
      await log(`module ${moduleId} ${runtimes[moduleId].status} | ${reason}`);
    } catch (e) {
      runtimes[moduleId] = { ...runtimes[moduleId], status: "error", finishedAt: new Date().toISOString(), error: shortText(e.message) };
      await log(`module ${moduleId} error | ${shortText(e.message)}`);
    }
    return runtimes[moduleId];
  }

  async function refresh({ force = false } = {}) {
    if (inFlight && !force) return snapshot;
    inFlight = true;
    try {
      const settings = await ensureSettings();
      const [bridge, cdp, crm, deploy, foreground] = await Promise.all([
        bridgeTabs(), cdpTabs(), readJson(paths.crm, {}), readJson(paths.deploy, { sites: [] }), foregroundEdgeTitle()
      ]);
      let tabs = bridge.online && bridge.tabs.length ? [...bridge.tabs] : [...cdp.tabs];
      const seen = new Set();
      tabs = tabs.filter(tab => {
        const key = `${tab.source}|${tab.url}|${tab.title}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      markForeground(tabs, foreground);
      const configs = { crm, deploy };
      const recognizedTabs = tabs.map(tab => ({ ...tab, modules: classifyTab(tab, configs) })).filter(tab => tab.modules.length > 0);
      const activeModules = [...new Set(recognizedTabs.flatMap(t => t.modules))];
      const moduleReasons = {};
      for (const m of activeModules) {
        moduleReasons[m] = recognizedTabs.filter(t => t.modules.includes(m)).map(t => ({ title: t.title, url: t.url, source: t.sourceLabel }));
      }
      const currentTab = tabs.find(t => t.focused) || tabs.find(t => t.active) || null;
      const signature = JSON.stringify(recognizedTabs.map(t => [t.source, t.url, t.modules]).sort());
      snapshot = {
        ...snapshot,
        enabled: settings.enabled !== false,
        autoRunReadOnly: settings.autoRunReadOnly !== false,
        pollMs: Number(settings.pollMs || 3000),
        cooldownMs: Number(settings.cooldownMs || 15000),
        bridgeOnline: bridge.online,
        cdpOnline: cdp.online,
        tabs,
        recognizedTabs,
        activeModules,
        moduleReasons,
        currentTab,
        runtimes,
        updatedAt: new Date().toISOString(),
        summary: activeModules.length ? `Авто: ${activeModules.map(moduleLabel).join(" + ")} (${recognizedTabs.length} вкладок)` : `Авто: браузер отслеживается, специализированные модули не требуются`
      };
      if (signature !== lastSignature) {
        lastSignature = signature;
        await log(`tabs changed | ${recognizedTabs.map(t => `${t.title}=>${t.modules.join('+')}`).join(" ; ") || "no recognized tabs"}`);
      }
      if (snapshot.enabled && snapshot.autoRunReadOnly) {
        const jobs = [];
        for (const moduleId of activeModules) {
          const tab = recognizedTabs.find(t => t.modules.includes(moduleId)) || currentTab;
          jobs.push(runModule(moduleId, `browser:${shortText(tab?.title || tab?.url || "context", 80)}`, tab, force));
        }
        await Promise.allSettled(jobs);
      }
      return snapshot;
    } finally { inFlight = false; }
  }

  async function start() {
    const settings = await ensureSettings();
    await refresh({ force: true });
    if (timer) clearInterval(timer);
    timer = setInterval(() => refresh().catch(() => {}), Math.max(1500, Number(settings.pollMs || 3000)));
    timer.unref?.();
    return snapshot;
  }

  function getSnapshot() { return snapshot; }

  async function setEnabled(enabled) {
    const settings = await ensureSettings();
    const next = { ...settings, enabled: Boolean(enabled) };
    await fs.writeFile(settingsFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    snapshot.enabled = next.enabled;
    await log(`auto ${next.enabled ? "enabled" : "disabled"}`);
    return refresh({ force: true });
  }

  return { start, refresh, getSnapshot, runModule, setEnabled };
}
