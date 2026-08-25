import http from "http";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { createBrowserAutoController } from "./browser-auto.mjs";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const DASHBOARD_DIR = path.join(ROOT, "dashboard");
const HOST = "127.0.0.1";
const PORT = 3210;

const PATHS = {
  registry: path.join(ROOT, "registry", "modules.json"),
  projects: path.join(ROOT, "config", "projects.json"),
  githubRegistry: path.join(ROOT, "config", "github-registry.json"),
  recovery: path.join(ROOT, "config", "recovery.json"),
  browser: path.join(ROOT, "config", "browser-state.json"),
  browserConfig: path.join(ROOT, "config", "browser.json"),
  crm: path.join(ROOT, "config", "crm.json"),
  deploy: path.join(ROOT, "config", "deploy.json"),
  elama: path.join(ROOT, "config", "elama.json"),
  elamaState: path.join(ROOT, "config", "elama-state.json"),
  direct: path.join(ROOT, "config", "direct.json"),
  directState: path.join(ROOT, "config", "direct-state.json"),
  logsDir: path.join(ROOT, "logs"),
  orchestratorTasks: path.join(ROOT, "orchestrator", "tasks.json"),
  orchestratorRules: path.join(ROOT, "orchestrator", "rules.json")
};

const MODULE_TOOL_DESCRIPTIONS = {
  "Project Manager": "Управляет реестром проектов, регистрацией и discovery.",
  "Recovery Module": "Собирает состояние для восстановления, checkpoints и rollback-проверок.",
  "GitHub Manager": "Контроль репозиториев, checkpoint и sync state.",
  "Browser Manager": "Управление Edge и рабочими веб-кабинетами.",
  "CRM Module": "Проверяет CRM, API и лиды.",
  "Deploy Module": "Проверяет сайты, HTTPS и готовность публикации.",
  "eLama Manager": "Контроль рекламных кампаний eLama.",
  "Direct Manager": "Контроль кампаний Яндекс Директ."
};

const MODULE_HINTS = {
  browser: { label: "Browser", title: "Browser Manager", group: "core" },
  github: { label: "GitHub", title: "GitHub Manager", group: "core" },
  crm: { label: "CRM", title: "CRM Module", group: "core" },
  deploy: { label: "Deploy", title: "Deploy Module", group: "core" },
  elama: { label: "eLama", title: "eLama Manager", group: "ads" },
  direct: { label: "Direct", title: "Direct Manager", group: "ads" },
  project_manager: { label: "Project Manager", title: "Project Manager", group: "system" },
  recovery: { label: "Recovery", title: "Recovery Module", group: "system" }
};

const browserAuto = createBrowserAutoController({
  root: ROOT,
  paths: { crm: PATHS.crm, deploy: PATHS.deploy, githubRegistry: PATHS.githubRegistry }
});
await browserAuto.start();

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readText(file, limit = 1800) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.slice(Math.max(0, text.length - limit));
  } catch {
    return "";
  }
}

async function statExists(file) {
  return fs.stat(file).then(() => true).catch(() => false);
}

async function gitInfo(projectPath) {
  const exists = await statExists(projectPath);
  if (!exists) return { exists: false, isGit: false, clean: false, branch: "", localCommit: "", remoteCommit: "", lastCommit: "" };
  try {
    const cwd = projectPath;
    const [branch, localCommit, status] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }),
      execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd }),
      execFileAsync("git", ["status", "--short"], { cwd }).catch(() => ({ stdout: "" }))
    ]);
    return {
      exists: true,
      isGit: true,
      clean: String(status.stdout || "").trim().length === 0,
      branch: String(branch.stdout || "").trim(),
      localCommit: String(localCommit.stdout || "").trim(),
      remoteCommit: "",
      lastCommit: String(localCommit.stdout || "").trim()
    };
  } catch {
    return { exists: true, isGit: false, clean: false, branch: "", localCommit: "", remoteCommit: "", lastCommit: "" };
  }
}

async function processStatus() {
  const processList = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Get-Process msedge -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { 'running' }"], { cwd: ROOT }).then(r => String(r.stdout || "").includes("running")).catch(() => false);
  return { edgeRunning: processList };
}

function moduleStatusFrom(module, registry, projects, system, logs) {
  const key = module.module.toLowerCase();
  const hint = MODULE_HINTS[key] || { label: module.module, title: module.module, group: "system" };
  const activity = system.currentTask || "";
  const runtime = system.auto?.runtimes?.[key] || null;
  let state = "idle";
  let lastCheckedAt = runtime?.finishedAt || runtime?.startedAt || module.lastCheckedAt || "";
  if (["browser", "elama", "direct"].includes(key)) {
    state = system[key]?.running ? "running" : "active";
    lastCheckedAt = system[key]?.checkedAt || lastCheckedAt;
  } else if (key === "github") {
    state = system.github?.available ? "active" : "warning";
    lastCheckedAt = system.github?.checkedAt || lastCheckedAt;
  } else if (key === "crm") {
    state = system.crm?.available ? "active" : "warning";
    lastCheckedAt = system.crm?.checkedAt || lastCheckedAt;
  } else if (key === "deploy") {
    state = system.deploy?.available ? "active" : "warning";
    lastCheckedAt = system.deploy?.checkedAt || lastCheckedAt;
  } else if (key === "project_manager") {
    state = "active";
  } else if (key === "recovery") {
    state = "active";
  }
  if (runtime?.status === "running") state = "running";
  else if (runtime?.status === "error") state = "error";
  else if (runtime?.status === "warning") state = "warning";
  else if (system.auto?.activeModules?.includes(key)) state = "active";
  else if (["browser", "elama", "direct"].includes(key) && !system.auto?.activeModules?.includes(key)) state = key === "browser" && system.browser?.running ? "active" : "idle";
  return {
    id: module.module,
    name: hint.label,
    title: hint.title,
    description: MODULE_TOOL_DESCRIPTIONS[hint.title] || "",
    tools: module.tools || [],
    capabilities: module.capabilities || [],
    active: Boolean(module.active),
    status: state,
    lastCheckedAt: lastCheckedAt || new Date().toISOString(),
    currentActivity: activity,
    tooltip: MODULE_TOOL_DESCRIPTIONS[hint.title] || `Module ${module.module}`,
    group: hint.group
  };
}

async function buildState() {
  const registry = await readJson(PATHS.registry, { modules: [] });
  const projects = await readJson(PATHS.projects, { projects: [] });
  const githubRegistry = await readJson(PATHS.githubRegistry, { projects: [] });
  const recovery = await readJson(PATHS.recovery, { projects: [] });
  const browserState = await readJson(PATHS.browser, { tabs: [] });
  const browserConfig = await readJson(PATHS.browserConfig, { profile: "Default", allowedSites: [] });
  const crmConfig = await readJson(PATHS.crm, {});
  const deployConfig = await readJson(PATHS.deploy, { sites: [] });
  const elamaState = await readJson(PATHS.elamaState, { campaigns: [] });
  const directState = await readJson(PATHS.directState, { campaigns: [] });
  const process = await processStatus();
  const autoContext = await browserAuto.refresh();
  const logs = await Promise.all(["actions", "projects", "recovery", "crm", "deploy", "elama", "direct", "tasks"].map(async name => [name, await readText(path.join(PATHS.logsDir, `${name}.log`))]));
  const logMap = Object.fromEntries(logs);
  const currentTask = autoContext.summary || (logMap.tasks || "").split("\n").reverse().find(line => line.trim()) || "Панель готова";
  const sys = {
    currentTask,
    auto: autoContext,
    browser: { running: process.edgeRunning, checkedAt: autoContext.updatedAt || new Date().toISOString(), tabs: autoContext.tabs?.length || 0, profile: browserState.profile || browserConfig.profile || "Default" },
    github: { available: githubRegistry.projects?.length > 0, checkedAt: recovery.lastGitHubSync || "", projects: githubRegistry.projects || [] },
    crm: { available: Boolean(crmConfig.apiUrl || crmConfig.healthUrl), checkedAt: crmConfig.lastCheckedAt || "" },
    deploy: { available: Array.isArray(deployConfig.sites) && deployConfig.sites.length > 0, checkedAt: new Date().toISOString(), sites: deployConfig.sites || [] },
    elama: { running: Boolean(elamaState.checkedAt), checkedAt: elamaState.checkedAt || "" },
    direct: { running: Boolean(directState.checkedAt), checkedAt: directState.checkedAt || "" }
  };
  const modules = (registry.modules || []).map(module => moduleStatusFrom(module, registry, projects, sys, logMap));
  const projectRows = (projects.projects || []).map(project => ({
    ...project,
    checkpoint: project.lastCheckpoint || "",
    githubSync: project.github?.divergence || project.divergence || "unknown",
    git: project.type === "git" ? "git" : "folder",
    status: project.clean === true ? "clean" : project.dirty ? "modified" : "warning"
  }));
  return {
    status: {
      app: "MCP-CLEAN Dashboard",
      host: HOST,
      port: PORT,
      modules: modules.length,
      projects: projectRows.length,
      browser: sys.browser,
      task: currentTask
    },
    modules,
    projects: projectRows,
    github: githubRegistry.projects || [],
    tasks: await readJson(PATHS.orchestratorTasks, { tasks: [] }),
    logs: logMap,
    recovery,
    browser: { state: { ...browserState, tabs: autoContext.tabs || [] }, config: browserConfig, live: autoContext },
    autoContext,
    crm: crmConfig,
    deploy: deployConfig,
    advertising: { elamaState, directState }
  };
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data, null, 2));
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath).then(data => {
    res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    res.end(data);
  }).catch(() => {
    res.writeHead(404);
    res.end("Not found");
  });
}

async function handleApi(req, res, url) {
  const state = await buildState();
  if (req.method === "GET" && url.pathname === "/api/full") return sendJson(res, state);
  if (req.method === "GET" && url.pathname === "/api/status") return sendJson(res, state.status);
  if (req.method === "GET" && url.pathname === "/api/modules") return sendJson(res, { modules: state.modules });
  if (req.method === "GET" && url.pathname === "/api/projects") return sendJson(res, { projects: state.projects });
  if (req.method === "GET" && url.pathname === "/api/github") return sendJson(res, { repositories: state.github });
  if (req.method === "GET" && url.pathname === "/api/tasks") return sendJson(res, { tasks: state.tasks.tasks || [], logs: state.logs });
  if (req.method === "GET" && url.pathname === "/api/logs") return sendJson(res, { logs: state.logs });
  if (req.method === "GET" && url.pathname === "/api/context") return sendJson(res, state.autoContext || browserAuto.getSnapshot());
  if (req.method === "POST" && ["/api/task/plan", "/api/task/run", "/api/module/run", "/api/checkpoint", "/api/auto/refresh", "/api/auto/toggle"].includes(url.pathname)) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    if (url.pathname === "/api/auto/refresh") return sendJson(res, await browserAuto.refresh({ force: true }));
    if (url.pathname === "/api/auto/toggle") return sendJson(res, await browserAuto.setEnabled(payload.enabled !== false));
    if (url.pathname === "/api/module/run") {
      const moduleId = String(payload.module || "").trim().toLowerCase();
      if (!moduleId) return sendJson(res, { ok: false, error: "module is required" }, 400);
      const live = await browserAuto.refresh();
      const tab = (live.recognizedTabs || []).find(t => (t.modules || []).includes(moduleId)) || live.currentTab || null;
      return sendJson(res, { ok: true, runtime: await browserAuto.runModule(moduleId, "manual-dashboard", tab, true) });
    }
    if (url.pathname === "/api/task/plan") {
      const task = String(payload.task || "").toLowerCase();
      const live = await browserAuto.refresh();
      const modules = new Set(live.activeModules || []);
      if (task.includes("лид") || task.includes("lead")) ["direct","elama","crm"].forEach(x => modules.add(x));
      if (task.includes("сайт") || task.includes("deploy") || task.includes("публикац")) modules.add("deploy");
      if (task.includes("git") || task.includes("github")) modules.add("github");
      if (task.includes("брауз") || task.includes("browser")) modules.add("browser");
      return sendJson(res, { ok: true, task: payload.task || "", modules: [...modules], source: "browser-context+task" });
    }
    if (url.pathname === "/api/task/run") {
      const modules = Array.isArray(payload.modules) ? payload.modules : [];
      const live = await browserAuto.refresh();
      const results = [];
      for (const moduleId of modules) {
        const tab = (live.recognizedTabs || []).find(t => (t.modules || []).includes(moduleId)) || live.currentTab || null;
        results.push(await browserAuto.runModule(String(moduleId), "task-dashboard", tab, true));
      }
      return sendJson(res, { ok: true, results });
    }
    return sendJson(res, { ok: true, endpoint: url.pathname, received: payload, note: "No external write was executed." });
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (handled !== false) return;
    return;
  }
  const file = url.pathname === "/" ? path.join(DASHBOARD_DIR, "index.html") : path.join(DASHBOARD_DIR, url.pathname);
  const ext = path.extname(file).toLowerCase();
  const type = ext === ".js" ? "text/javascript; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
  return serveFile(res, file, type);
});

server.listen(PORT, HOST, () => {
  console.log(`MCP-CLEAN Dashboard listening on http://${HOST}:${PORT}`);
});
