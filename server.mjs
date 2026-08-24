import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const ROOT = "F:\\MCP-CLEAN";
const CONFIG = path.join(ROOT, "config", "allowed-roots.json");
const BACKUPS = path.join(ROOT, "backups");
const LOGS = path.join(ROOT, "logs");
const ACTIONS_LOG = path.join(LOGS, "actions.log");
const TEMP = path.join(ROOT, "temp");
const EXCHANGE = path.join(ROOT, "exchange");
const EXCHANGE_PROJECTS = path.join(EXCHANGE, "projects");
const EXCHANGE_REGISTRY = path.join(EXCHANGE, "registry.json");
const PROJECTS_CONFIG = path.join(ROOT, "config", "projects.json");
const GITHUB_REGISTRY = path.join(ROOT, "config", "github-registry.json");
const RECOVERY_CONFIG = path.join(ROOT, "config", "recovery.json");
const BROWSER_CONFIG = path.join(ROOT, "config", "browser.json");
const BROWSER_STATE = path.join(ROOT, "config", "browser-state.json");
const CRM_CONFIG = path.join(ROOT, "config", "crm.json");
const DEPLOY_CONFIG = path.join(ROOT, "config", "deploy.json");
const DISCOVERY_ROOT = "C:\\Users\\oleg\\codex-test";
const PROJECTS_LOG = path.join(LOGS, "projects.log");
const RECOVERY_LOG = path.join(LOGS, "recovery.log");
const BROWSER_LOG = path.join(LOGS, "browser.log");
const CRM_LOG = path.join(LOGS, "crm.log");
const DEPLOY_LOG = path.join(LOGS, "deploy.log");
const GIT_CANDIDATES = ["git", "C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe"];
const MANAGED_PROJECTS = [
  "CRM",
  "CRM-Mobile-2",
  "MBA-ALBUMS",
  "MBA-ALBUMS-PROD",
  "MBA-ALBUMS-TILDA-OFF-2",
  "MBA-ALBUMS-WEB2-CONNECT",
  "mba-academy-site",
  "Site-universe",
  "Site-wedding",
  "Content-Automation",
  "MCP-CLEAN"
];

async function bootstrap() {
  await Promise.all([
    fs.mkdir(BACKUPS, { recursive: true }),
    fs.mkdir(LOGS, { recursive: true }),
    fs.mkdir(TEMP, { recursive: true }),
    fs.mkdir(EXCHANGE, { recursive: true }),
    fs.mkdir(EXCHANGE_PROJECTS, { recursive: true })
  ]); 
  await fs.appendFile(ACTIONS_LOG, "", "utf8");
  await fs.appendFile(PROJECTS_LOG, "", "utf8");
  await fs.appendFile(RECOVERY_LOG, "", "utf8");
  await fs.appendFile(BROWSER_LOG, "", "utf8");
  await fs.writeFile(PROJECTS_CONFIG, await fs.readFile(PROJECTS_CONFIG, "utf8").catch(() => "{\"projects\":[]}\n"), "utf8").catch(() => {});
  await fs.writeFile(GITHUB_REGISTRY, await fs.readFile(GITHUB_REGISTRY, "utf8").catch(() => "{\"projects\":[]}\n"), "utf8").catch(() => {});
  await fs.writeFile(RECOVERY_CONFIG, await fs.readFile(RECOVERY_CONFIG, "utf8").catch(() => "{\"lastCheckedAt\":\"\",\"projects\":[],\"lastGitHubSync\":\"\",\"githubStatus\":\"unknown\"}\n"), "utf8").catch(() => {});
  await fs.writeFile(BROWSER_CONFIG, await fs.readFile(BROWSER_CONFIG, "utf8").catch(() => "{\"browser\":\"Edge\",\"profile\":\"Default\",\"allowedSites\":[\"eLama\",\"Яндекс Директ\",\"CRM\",\"GitHub\",\"Firebase\"]}\n"), "utf8").catch(() => {});
  await fs.writeFile(BROWSER_STATE, await fs.readFile(BROWSER_STATE, "utf8").catch(() => "{\"lastSavedAt\":\"\",\"profile\":\"Default\",\"tabs\":[]}\n"), "utf8").catch(() => {});
  await fs.writeFile(CRM_CONFIG, await fs.readFile(CRM_CONFIG, "utf8").catch(() => "{\"projectPath\":\"C:\\\\Users\\\\oleg\\\\codex-test\\\\CRM\",\"apiUrl\":\"\",\"healthUrl\":\"\",\"githubRemote\":\"https://github.com/olegzh100/CRM.git\"}\n"), "utf8").catch(() => {});
  await fs.writeFile(DEPLOY_CONFIG, await fs.readFile(DEPLOY_CONFIG, "utf8").catch(() => "{\"sites\":[{\"site\":\"https://example.com\",\"server\":\"default\",\"type\":\"static\",\"gitRemote\":\"\"}]}\n"), "utf8").catch(() => {});
}

function normalizePath(target) {
  return path.resolve(target);
}

function isWithinRoot(target, root) {
  const relative = path.relative(normalizePath(root), normalizePath(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createError(code, message, data) {
  const error = new Error(message);
  error.name = code;
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

function toErrorResult(error) {
  return {
    isError: true,
    content: [{ type: "text", text: `${error.code || "ERROR"}: ${error.message || "Unknown error"}` }]
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupName(targetPath) {
  return `${path.basename(targetPath)}.${timestamp()}.bak`;
}

function archiveName(targetPath) {
  return `${path.basename(targetPath)}.${timestamp()}.zip`;
}

function normalizeToolResult(result) {
  return JSON.stringify(result, null, 2);
}

async function loadConfig() {
  const raw = await fs.readFile(CONFIG, "utf8");
  const config = JSON.parse(raw);
  if (!Array.isArray(config?.readWrite)) {
    throw createError("CONFIG_ERROR", "allowed-roots.json must contain readWrite array");
  }
  return config;
}

async function loadProjectsConfig() {
  const raw = await fs.readFile(PROJECTS_CONFIG, "utf8").catch(() => "{\"projects\":[]}\n");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { projects: parsed };
    }
    if (!Array.isArray(parsed?.projects)) {
      return { projects: [] };
    }
    return parsed;
  } catch {
    return { projects: [] };
  }
}

async function loadGitHubRegistry() {
  const raw = await fs.readFile(GITHUB_REGISTRY, "utf8").catch(() => "{\"projects\":[]}\n");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { projects: parsed };
    }
    const projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
    if (projects.length > 0) {
      return parsed;
    }
    const seed = await loadProjectsConfig().then(data => Array.isArray(data?.projects) ? data.projects : []).catch(() => []);
    return { projects: seed.map(project => ({
      name: project.name,
      path: project.path,
      remote: project.remote || "",
      branch: project.branch || null,
      lastCheckpoint: project.lastCheckpoint || "",
      lastSync: project.lastSync || ""
    })) };
  } catch {
    const projects = await loadProjectsConfig().then(data => Array.isArray(data?.projects) ? data.projects : []).catch(() => []);
    return { projects: projects.map(project => ({
      name: project.name,
      path: project.path,
      remote: project.remote || "",
      branch: project.branch || null,
      lastCheckpoint: project.lastCheckpoint || "",
      lastSync: project.lastSync || ""
    })) };
  }
}

async function saveGitHubRegistry(data) {
  await fs.writeFile(GITHUB_REGISTRY, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function saveProjectsConfig(data) {
  await fs.writeFile(PROJECTS_CONFIG, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function loadRecoveryConfig() {
  const raw = await fs.readFile(RECOVERY_CONFIG, "utf8").catch(() => "{\"lastCheckedAt\":\"\",\"projects\":[],\"lastGitHubSync\":\"\",\"githubStatus\":\"unknown\"}\n");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.projects)) {
      parsed.projects = [];
    }
    return parsed;
  } catch {
    return { lastCheckedAt: "", projects: [], lastGitHubSync: "", githubStatus: "unknown" };
  }
}

async function saveRecoveryConfig(data) {
  await fs.writeFile(RECOVERY_CONFIG, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function loadBrowserConfig() {
  const raw = await fs.readFile(BROWSER_CONFIG, "utf8").catch(() => "{\"browser\":\"Edge\",\"profile\":\"Default\",\"allowedSites\":[\"eLama\",\"Яндекс Директ\",\"CRM\",\"GitHub\",\"Firebase\"]}\n");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.allowedSites)) parsed.allowedSites = [];
    return parsed;
  } catch {
    return { browser: "Edge", profile: "Default", allowedSites: ["eLama", "Яндекс Директ", "CRM", "GitHub", "Firebase"] };
  }
}

async function loadCrmConfig() {
  const raw = await fs.readFile(CRM_CONFIG, "utf8").catch(() => "{\"projectPath\":\"C:\\\\Users\\\\oleg\\\\codex-test\\\\CRM\",\"apiUrl\":\"\",\"healthUrl\":\"\",\"githubRemote\":\"https://github.com/olegzh100/CRM.git\"}\n");
  try {
    const parsed = JSON.parse(raw);
    return {
      projectPath: parsed.projectPath || "C:\\Users\\oleg\\codex-test\\CRM",
      apiUrl: parsed.apiUrl || "",
      healthUrl: parsed.healthUrl || "",
      githubRemote: parsed.githubRemote || ""
    };
  } catch {
    return { projectPath: "C:\\Users\\oleg\\codex-test\\CRM", apiUrl: "", healthUrl: "", githubRemote: "" };
  }
}

async function loadDeployConfig() {
  const raw = await fs.readFile(DEPLOY_CONFIG, "utf8").catch(() => "{\"sites\":[{\"site\":\"https://example.com\",\"server\":\"default\",\"type\":\"static\",\"gitRemote\":\"\"}]}\n");
  try {
    const parsed = JSON.parse(raw);
    return { sites: Array.isArray(parsed?.sites) ? parsed.sites : [] };
  } catch {
    return { sites: [] };
  }
}

async function httpCheck(url, timeoutMs = 4000) {
  if (!url) return { ok: false, status: null, timeMs: null, error: "missing url" };
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "GET" });
    return { ok: response.ok, status: response.status, timeMs: Date.now() - started, error: "" };
  } catch (error) {
    return { ok: false, status: null, timeMs: Date.now() - started, error: error?.message || "request failed" };
  }
}

async function saveBrowserState(data) {
  await fs.writeFile(BROWSER_STATE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function loadBrowserState() {
  const raw = await fs.readFile(BROWSER_STATE, "utf8").catch(() => "{\"lastSavedAt\":\"\",\"profile\":\"Default\",\"tabs\":[]}\n");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs)) parsed.tabs = [];
    return parsed;
  } catch {
    return { lastSavedAt: "", profile: "Default", tabs: [] };
  }
}

async function browserProcessRunning() {
  try {
    const result = await runCommand("powershell.exe", ["-NoProfile", "-Command", "Get-Process msedge -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { 'running' }"], ROOT);
    return result.stdout.trim() === "running";
  } catch {
    return false;
  }
}

async function browserStatusInfo() {
  const config = await loadBrowserConfig();
  const state = await loadBrowserState();
  const running = await browserProcessRunning();
  return {
    browser: config.browser || "Edge",
    profile: config.profile || "Default",
    running,
    manageable: running,
    tabs: state.tabs.length,
    allowedSites: config.allowedSites || []
  };
}

async function browserTabsInfo() {
  const state = await loadBrowserState();
  return {
    profile: state.profile || "Default",
    tabs: (state.tabs || []).map(tab => ({
      title: tab.title || "",
      url: tab.url || "",
      profile: state.profile || "Default",
      state: tab.state || "unknown"
    }))
  };
}

function browserSiteAllowed(url, allowedSites) {
  const target = String(url || "").toLowerCase();
  return allowedSites.some(site => target.includes(String(site).toLowerCase()));
}

async function browserOpenUrl(url, useNewTab = true) {
  const config = await loadBrowserConfig();
  if (!browserSiteAllowed(url, config.allowedSites || [])) {
    throw createError("ACCESS_DENIED", "URL is not in allowed browser sites list", { url });
  }
  const edge = "msedge.exe";
  const args = ["--profile-directory=Default", url];
  if (useNewTab) args.unshift("--new-tab");
  await runCommand("powershell.exe", ["-NoProfile", "-Command", `Start-Process -FilePath '${edge}' -ArgumentList ${JSON.stringify(args.map(String))}`], ROOT);
  const state = await loadBrowserState();
  const tabs = Array.isArray(state.tabs) ? [...state.tabs] : [];
  tabs.push({ title: url, url, state: "opened" });
  const next = { lastSavedAt: state.lastSavedAt || new Date().toISOString(), profile: config.profile || state.profile || "Default", tabs };
  await saveBrowserState(next);
  await fs.appendFile(BROWSER_LOG, `${new Date().toISOString()} | open | ${url}\n`, "utf8");
  return { opened: true, url, newTab: useNewTab, profile: next.profile };
}

async function browserCheckpoint() {
  const config = await loadBrowserConfig();
  const state = await loadBrowserState();
  const payload = {
    lastSavedAt: new Date().toISOString(),
    profile: config.profile || state.profile || "Default",
    tabs: state.tabs || []
  };
  await saveBrowserState(payload);
  await fs.appendFile(BROWSER_LOG, `${payload.lastSavedAt} | checkpoint | ${payload.tabs.length}\n`, "utf8");
  return payload;
}

async function browserRestore() {
  const state = await loadBrowserState();
  const config = await loadBrowserConfig();
  const restoredTabs = [];
  for (const tab of state.tabs || []) {
    if (!tab.url) continue;
    if (!browserSiteAllowed(tab.url, config.allowedSites || [])) continue;
    await browserOpenUrl(tab.url, true);
    restoredTabs.push(tab.url);
  }
  await fs.appendFile(BROWSER_LOG, `${new Date().toISOString()} | restore | ${restoredTabs.length}\n`, "utf8");
  return { restored: restoredTabs.length, profile: state.profile || config.profile || "Default", tabs: restoredTabs };
}

async function crmApiCheck(dryRun = false) {
  const config = await loadCrmConfig();
  const url = config.healthUrl || config.apiUrl || "";
  if (dryRun) {
    return { dryRun: true, url, endpointAvailable: Boolean(url), statusCode: null, timeMs: null, ok: Boolean(url) };
  }
  const result = await httpCheck(url);
  await logCrm("api_check", `${url} | ${result.status || "ERR"} | ${result.timeMs || 0}ms`);
  return { dryRun: false, url, endpointAvailable: Boolean(url), statusCode: result.status, timeMs: result.timeMs, ok: result.ok };
}

async function crmLeadsCheck(dryRun = false) {
  const config = await loadCrmConfig();
  const projectPath = config.projectPath;
  const git = await gitStatus(projectPath);
  const payload = {
    dryRun,
    available: Boolean(projectPath),
    newLeads: dryRun ? 0 : null,
    lastLead: dryRun ? "" : null,
    transferErrors: [],
    project: git
  };
  await logCrm("leads_check", dryRun ? "dryRun" : "checked");
  return payload;
}

async function crmStatus(dryRun = false) {
  const config = await loadCrmConfig();
  const project = await gitStatus(config.projectPath);
  const api = await crmApiCheck(true);
  const httpsOk = String(config.healthUrl || config.apiUrl || "").startsWith("https://");
  const backendAvailable = Boolean(config.apiUrl || config.healthUrl);
  return {
    dryRun,
    crm: project.isGit && project.status !== "unknown" ? "OK" : "ERROR",
    api: api.ok ? "OK" : "ERROR",
    https: httpsOk ? "OK" : "ERROR",
    services: project.isGit ? "OK" : "ERROR",
    project: project,
    backendAvailable,
    lastCommit: project.lastCommit,
    branch: project.branch,
    remote: config.githubRemote || project.hasRemote
  };
}

async function crmCheckpoint(dryRun = false) {
  const config = await loadCrmConfig();
  const backup = await backupProjectInfo(config.projectPath);
  const checkpoint = await gitCheckpoint(config.projectPath, `CRM checkpoint ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, dryRun);
  await logCrm("checkpoint", dryRun ? "dryRun" : `${backup.archivePath} | ${checkpoint.commitHash || ""}`);
  return { dryRun, backup, checkpoint };
}

async function deployStatus(dryRun = false) {
  const config = await loadDeployConfig();
  const sites = [];
  for (const site of config.sites) {
    const result = { site: site.site, server: site.server || "", type: site.type || "", gitRemote: site.gitRemote || "", state: "unknown", lastDeploy: site.lastDeploy || "" };
    sites.push(result);
  }
  return { dryRun, sites };
}

async function deployCheck(dryRun = false) {
  const config = await loadDeployConfig();
  const checks = [];
  for (const site of config.sites) {
    const probe = dryRun ? { ok: Boolean(site.site), status: null, timeMs: null } : await httpCheck(site.site);
    checks.push({ site: site.site, https: String(site.site || "").startsWith("https://") ? "OK" : "ERROR", status: probe.status, timeMs: probe.timeMs, available: probe.ok });
  }
  return { dryRun, checks };
}

async function deployPrepare(dryRun = false) {
  const config = await loadDeployConfig();
  const projectPath = config.sites[0]?.projectPath || "F:\\MCP-CLEAN";
  const backup = await backupProjectInfo(projectPath);
  const checkpoint = await gitCheckpoint(projectPath, `Deploy prepare ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, dryRun);
  await logDeploy("prepare", dryRun ? "dryRun" : `${backup.archivePath} | ${checkpoint.commitHash || ""}`);
  return { dryRun, backup, checkpoint, git: await gitStatus(projectPath) };
}

async function deployHistory() {
  const config = await loadDeployConfig();
  return { sites: config.sites.map(site => ({ site: site.site, lastDeploy: site.lastDeploy || "", commit: site.lastCommit || "", result: site.result || "" })) };
}

let allowedRootsState = [];

async function saveConfig(config) {
  await fs.writeFile(CONFIG, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function makeRootMatcher(allowedRoots) {
  const roots = allowedRoots.map(normalizePath);
  return target => roots.some(root => isWithinRoot(target, root));
}

function refreshAllowedRoots(nextRoots) {
  allowedRootsState = nextRoots.map(normalizePath);
}

function assertAllowed(target, isAllowed) {
  if (!target || typeof target !== "string") {
    throw createError("INVALID_ARGUMENT", "Path is required");
  }
  const resolved = normalizePath(target);
  if (!isAllowed(resolved)) {
    throw createError("ACCESS_DENIED", "Path is outside allowed roots", { path: resolved });
  }
  return resolved;
}

async function runCommand(command, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        const err = new Error(stderr.trim() || `${command} exited with code ${code}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

async function resolveGitCommand() {
  for (const candidate of GIT_CANDIDATES) {
    if (candidate === "git") return candidate;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return "git";
}

async function runGit(cwd, args) {
  const command = await resolveGitCommand();
  return await runCommand(command, ["-c", `safe.directory=${cwd}`, "-C", cwd, ...args], ROOT);
}

async function gitAvailable() {
  try {
    await runGit(ROOT, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function gitStatus(projectPath) {
  const result = {
    path: projectPath,
    isGit: false,
    branch: null,
    lastCommit: null,
    dirty: null,
    hasRemote: false,
    originConnected: false,
    status: "unknown"
  };

  try {
    await runGit(projectPath, ["rev-parse", "--show-toplevel"]);
    result.isGit = true;
  } catch {
    try {
      const gitEntry = path.join(projectPath, ".git");
      const stat = await fs.stat(gitEntry);
      result.isGit = stat.isFile() || stat.isDirectory();
    } catch {
      return result;
    }
  }

  try {
    const branch = await runGit(projectPath, ["branch", "--show-current"]);
    result.branch = branch.stdout.trim() || "(detached)";
  } catch {
    result.branch = null;
  }

  try {
    const commit = await runGit(projectPath, ["rev-parse", "--short", "HEAD"]);
    result.lastCommit = commit.stdout.trim();
  } catch {
    result.lastCommit = null;
  }

  try {
    const porcelain = await runGit(projectPath, ["status", "--porcelain"]);
    result.dirty = porcelain.stdout.trim().length > 0;
    result.status = result.dirty ? "modified" : "clean";
  } catch {
    result.dirty = null;
  }

  try {
    const remotes = await runGit(projectPath, ["remote"]);
    result.hasRemote = remotes.stdout.trim().length > 0;
    if (result.hasRemote) {
      const origin = await runGit(projectPath, ["remote", "get-url", "origin"]);
      result.originConnected = origin.stdout.trim().length > 0;
    }
  } catch {
    result.hasRemote = false;
    result.originConnected = false;
  }

  return result;
}

async function gitCheckpoint(projectPath, message, dryRun = false) {
  const statusBefore = await runGit(projectPath, ["status", "--porcelain"]).then(r => r.stdout.trim()).catch(() => "");
  const result = { dryRun, statusBefore, message, commitHash: null, push: dryRun ? "dry-run" : "not-run" };
  if (dryRun) return result;
  await runGit(projectPath, ["add", "--", "."]);
  await runGit(projectPath, ["commit", "-m", message]);
  const hash = await runGit(projectPath, ["rev-parse", "--short", "HEAD"]);
  result.commitHash = hash.stdout.trim();
  try {
    await runGit(projectPath, ["push", "origin", "main"]);
    result.push = "ok";
  } catch (error) {
    result.push = `failed: ${error.message}`;
  }
  await logAction("git_checkpoint", path.basename(projectPath), "commit+push", result.push);
  return result;
}

async function listGitCheckpoints(projectPath, limit = 12) {
  try {
    const result = await runGit(projectPath, ["log", `--max-count=${limit}`, "--pretty=format:%H|%h|%s|%cI"]);
    return result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [full, short, subject, iso] = line.split("|");
        return { full, short, subject, iso };
      });
  } catch {
    return [];
  }
}

async function archiveProject(projectPath) {
  const archivePath = path.join(BACKUPS, archiveName(projectPath));
  const sourcePattern = path.join(projectPath, "*");
  await runCommand(
    "powershell.exe",
    ["-NoProfile", "-Command", `Compress-Archive -Path "${sourcePattern}" -DestinationPath "${archivePath}" -Force`],
    ROOT
  );
  const stat = await fs.stat(archivePath);
  return { archivePath, projectPath, sizeBytes: stat.size };
}

async function backupProjectInfo(projectPath) {
  const existingBefore = await fs.readdir(BACKUPS).catch(() => []);
  const info = await archiveProject(projectPath);
  const existingAfter = await fs.readdir(BACKUPS).catch(() => []);
  return {
    ...info,
    projectInfo: { name: path.basename(projectPath) },
    backups: existingAfter.filter(name => name.toLowerCase().endsWith(".zip")),
    createdBackups: existingAfter.filter(name => !existingBefore.includes(name) && name.toLowerCase().endsWith(".zip"))
  };
}

async function log(message) {
  await fs.appendFile(path.join(LOGS, "mcp-clean.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
}

async function logAction(tool, project, action, result) {
  await fs.appendFile(ACTIONS_LOG, `${new Date().toISOString()} | ${tool} | ${project || ""} | ${action} | ${result}\n`, "utf8");
}

async function logProject(action, project, result) {
  await fs.appendFile(PROJECTS_LOG, `${new Date().toISOString()} | ${action} | ${project || ""} | ${result}\n`, "utf8");
}

async function logCrm(action, result) {
  await fs.appendFile(CRM_LOG, `${new Date().toISOString()} | ${action} | ${result}\n`, "utf8");
}

async function logDeploy(action, result) {
  await fs.appendFile(DEPLOY_LOG, `${new Date().toISOString()} | ${action} | ${result}\n`, "utf8");
}

async function gitRemoteState(projectPath) {
  const status = await gitStatus(projectPath);
  const info = {
    remote: "",
    remoteAvailable: false,
    remoteCommit: null,
    localCommit: status.lastCommit,
    branch: status.branch,
    divergence: "unknown",
    available: status.isGit
  };

  if (!status.isGit || !status.hasRemote) {
    return info;
  }

  try {
    const remoteUrl = await runGit(projectPath, ["remote", "get-url", "origin"]);
    info.remote = remoteUrl.stdout.trim();
    info.remoteAvailable = true;
  } catch {
    info.remoteAvailable = false;
  }

  try {
    const branch = status.branch && status.branch !== "(detached)" ? status.branch : "HEAD";
    const remoteHead = await runGit(projectPath, ["ls-remote", "origin", branch === "HEAD" ? "HEAD" : `refs/heads/${branch}`]);
    const firstLine = remoteHead.stdout.trim().split("\n").find(Boolean) || "";
    const [remoteCommit] = firstLine.split(/\s+/);
    info.remoteCommit = remoteCommit || null;
    if (info.remoteCommit && info.localCommit) {
      info.divergence = info.remoteCommit.startsWith(info.localCommit) || info.localCommit.startsWith(info.remoteCommit) ? "synced" : "diverged";
    } else {
      info.divergence = "unknown";
    }
  } catch {
    info.remoteAvailable = false;
  }

  return info;
}

async function syncProjectState(projectPath) {
  const local = await gitStatus(projectPath);
  const remote = await gitRemoteState(projectPath);
  const difference = {
    localCommit: local.lastCommit,
    remoteCommit: remote.remoteCommit,
    branch: local.branch,
    divergence: remote.divergence,
    dirty: local.dirty,
    remoteAvailable: remote.remoteAvailable,
    hasRemote: local.hasRemote,
    status: !local.isGit ? "no-git" : remote.remoteAvailable ? (remote.divergence === "synced" ? "synced" : "sync-needed") : "no-access"
  };
  return { path: projectPath, local, remote, difference };
}

async function loadGitHubRegistryProjects() {
  const registry = await loadGitHubRegistry();
  return Array.isArray(registry.projects) ? registry.projects : [];
}

async function saveGitHubRegistryProjects(projects) {
  await saveGitHubRegistry({ projects });
}

async function githubStatusAll(dryRun = false) {
  const registryProjects = await loadGitHubRegistryProjects();
  const projects = [];
  for (const project of registryProjects) {
    const projectPath = normalizePath(project.path);
    const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
    const local = exists ? await gitStatus(projectPath) : { isGit: false, branch: null, lastCommit: null, dirty: null, hasRemote: false, originConnected: false, status: "error" };
    const remote = dryRun
      ? { remote: project.remote || "", remoteAvailable: Boolean(project.remote || local.hasRemote), remoteCommit: null, divergence: "unknown", available: exists && local.isGit }
      : (exists ? await gitRemoteState(projectPath) : { remote: project.remote || "", remoteAvailable: false, remoteCommit: null, divergence: "error", available: false });
    const state = !exists || !local.isGit
      ? "error"
      : dryRun
        ? (local.dirty ? "modified" : "synchronized")
        : remote.remoteAvailable
          ? (remote.divergence === "synced" ? "synchronized" : (local.dirty ? "modified" : (remote.divergence === "diverged" ? (remote.remoteCommit && local.lastCommit && remote.remoteCommit.startsWith(local.lastCommit) ? "ahead" : "behind") : "error")))
          : "error";
    projects.push({
      name: project.name,
      path: projectPath,
      remote: project.remote || remote.remote || "",
      available: exists && local.isGit && Boolean((project.remote || remote.remote) || local.hasRemote),
      branch: local.branch,
      localCommit: local.lastCommit,
      remoteCommit: remote.remoteCommit,
      state
    });
  }
  const payload = { dryRun, projects };
  if (!dryRun) {
    await saveGitHubRegistryProjects(projects.map(project => ({
      name: project.name,
      path: project.path,
      remote: project.remote,
      branch: project.branch,
      lastCheckpoint: project.localCommit || "",
      lastSync: new Date().toISOString()
    })));
  }
  return payload;
}

async function githubSyncCheck(projectPath, dryRun = false) {
  const local = await gitStatus(projectPath);
  const remote = dryRun
    ? { remoteCommit: null, remoteAvailable: Boolean(local.hasRemote), divergence: "unknown" }
    : await gitRemoteState(projectPath);
  return {
    path: projectPath,
    LOCAL: local.lastCommit,
    REMOTE: remote.remoteCommit,
    DIFFERENCE: !local.isGit ? "error" : dryRun ? (local.dirty ? "modified" : "none") : remote.remoteAvailable ? (local.lastCommit === remote.remoteCommit ? "none" : (local.dirty ? "modified" : "different")) : "error"
  };
}

async function githubCheckpointAll(dryRun = false) {
  const registryProjects = await loadGitHubRegistryProjects();
  const results = [];
  const changedProjects = [];
  for (const project of registryProjects) {
    const projectPath = normalizePath(project.path);
    const status = await gitStatus(projectPath);
    if (!status.isGit) continue;
    const changed = Boolean(status.dirty);
    if (changed) changedProjects.push(project.name);
    const message = `Global checkpoint ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    let commitHash = null;
    let push = "skipped";
    let backupPath = "";
    if (!dryRun && changed) {
      const backup = await archiveProject(projectPath);
      backupPath = backup.archivePath;
      await runGit(projectPath, ["add", "--", "."]);
      await runGit(projectPath, ["commit", "-m", message]);
      const hash = await runGit(projectPath, ["rev-parse", "--short", "HEAD"]);
      commitHash = hash.stdout.trim();
      try {
        await runGit(projectPath, ["push", "origin", "main"]);
        push = "ok";
      } catch (error) {
        push = `failed: ${error.message}`;
      }
    }
    results.push({ name: project.name, path: projectPath, changed, commitHash, push, backup: backupPath });
  }
  if (!dryRun) {
    await saveGitHubRegistryProjects(registryProjects.map(project => ({ ...project, lastSync: new Date().toISOString(), lastCheckpoint: results.find(item => item.name === project.name)?.commitHash || project.lastCheckpoint || "" })));
  }
  return { dryRun, changedProjects, savedProjects: results.filter(item => item.changed).map(item => ({ name: item.name, commitHash: item.commitHash, push: item.push })), results };
}

async function loadProjectsRegistry() {
  const data = await loadProjectsConfig();
  return data.projects || [];
}

async function saveProjectsRegistry(projects) {
  await saveProjectsConfig({ projects });
}

async function readRegistry() {
  const raw = await fs.readFile(EXCHANGE_REGISTRY, "utf8").catch(() => "{}");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeRegistry(registry) {
  await fs.writeFile(EXCHANGE_REGISTRY, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

async function ensureProjectControlStructure(projectName) {
  const projectDir = path.join(EXCHANGE_PROJECTS, projectName);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(path.join(projectDir, "incoming"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "outgoing"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "notes"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "README.txt"),
    [
      `Project: ${projectName}`,
      "Managed by MCP-CLEAN.",
      "incoming/ - inbound files",
      "outgoing/ - outbound files",
      "notes/ - project notes"
    ].join("\n") + "\n",
    "utf8"
  );
  return projectDir;
}

async function updateProjectsRegistry(entry) {
  const projects = await loadProjectsRegistry();
  const index = projects.findIndex(item => item.name === entry.name);
  const next = {
    name: entry.name,
    path: normalizePath(entry.path),
    type: entry.type || "git",
    remote: entry.remote || "",
    registeredAt: entry.registeredAt || new Date().toISOString(),
    lastCheckpoint: entry.lastCheckpoint || ""
  };
  if (index >= 0) {
    projects[index] = { ...projects[index], ...next };
  } else {
    projects.push(next);
  }
  await saveProjectsRegistry(projects);
  await logProject("add", next.name, next.path);
  return next;
}

async function removeProjectsRegistry(name) {
  const projects = await loadProjectsRegistry();
  const next = projects.filter(item => item.name !== name);
  await saveProjectsRegistry(next);
  await logProject("remove", name, "ok");
  return next;
}

async function listProjectControlFiles(projectName) {
  const projectDir = path.join(EXCHANGE_PROJECTS, projectName);
  const entries = await fs.readdir(projectDir).catch(() => []);
  return entries;
}

async function updateAllowedRoots(nextRoots) {
  const current = await loadConfig();
  current.readWrite = nextRoots;
  await saveConfig(current);
  return current;
}

async function registerProject(projectName, projectPath, dryRun = false) {
  const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
  const safe = isWithinRoot(projectPath, ROOT) || isWithinRoot(projectPath, "C:\\Users\\oleg\\codex-test");
  if (!safe) {
    throw createError("INVALID_ARGUMENT", "Project path is outside safe locations", { projectPath });
  }
  const git = exists ? await gitStatus(projectPath) : { isGit: false, hasRemote: false, originConnected: false, branch: null, lastCommit: null, status: "missing" };
  const nextRoots = Array.from(new Set([...allowedRootsState, normalizePath(projectPath)]));
  const projectDir = path.join(EXCHANGE_PROJECTS, projectName);
  const checkpointPreview = {
    projectPath,
    projectName,
    message: `Register project ${projectName}`
  };

  if (dryRun) {
    return {
      dryRun: true,
      exists,
      access: exists,
      safe,
      git,
      nextRoots,
      exchangeProjectDir: projectDir,
      checkpointPreview
    };
  }

  await updateAllowedRoots(nextRoots);
  refreshAllowedRoots(nextRoots);
  await ensureProjectControlStructure(projectName);
  let checkpoint = null;
  let checkpointError = null;
  try {
    checkpoint = await gitCheckpoint(ROOT, `Register project ${projectName}`, false);
  } catch (error) {
    checkpointError = `${error.code || "ERROR"}: ${error.message || String(error)}`;
  }
  const registry = await readRegistry();
  registry[projectName] = {
    path: normalizePath(projectPath),
    registeredAt: new Date().toISOString()
  };
  await writeRegistry(registry);
  const projectMeta = await updateProjectsRegistry({
    name: projectName,
    path: projectPath,
    type: git.isGit ? "git" : "folder",
    remote: git.hasRemote ? "origin" : "",
    registeredAt: new Date().toISOString(),
    lastCheckpoint: checkpoint?.commitHash || ""
  });
  await logAction("register_project", projectName, "register", "ok");
  return {
    dryRun: false,
    exists,
    safe,
    git,
    exchangeProjectDir: projectDir,
    projectMeta,
    checkpoint,
    checkpointError
  };
}

async function unregisterProject(projectName, projectPath, dryRun = false) {
  const registry = await readRegistry();
  const nextRoots = allowedRootsState.filter(root => normalizePath(root) !== normalizePath(projectPath));
  if (dryRun) {
    return {
      dryRun: true,
      projectName,
      projectPath,
      nextRoots
    };
  }
  await updateAllowedRoots(nextRoots);
  refreshAllowedRoots(nextRoots);
  delete registry[projectName];
  await writeRegistry(registry);
  await removeProjectsRegistry(projectName);
  await logAction("unregister_project", projectName, "unregister", "ok");
  return {
    dryRun: false,
    projectName,
    projectPath,
    nextRoots
  };
}

async function restoreCommit(projectPath, commit, dryRun = false) {
  const before = await gitStatus(projectPath);
  const checkpoint = await archiveProject(projectPath);
  if (dryRun) return { dryRun: true, before, checkpoint, commit };
  await runGit(projectPath, ["reset", "--hard", commit]);
  return { dryRun: false, before, checkpoint, commit, after: await gitStatus(projectPath) };
}

async function systemStatus(projects) {
  const recovery = await loadRecoveryConfig();
  const githubRegistry = await loadGitHubRegistryProjects();
  const githubCounts = {
    projects: githubRegistry.length,
    synchronized: 0,
    problematic: 0
  };
  const results = [];
  for (const { name, path: projectPath } of projects) {
    const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
    const git = exists ? await gitStatus(projectPath) : { isGit: false, branch: null, lastCommit: null, dirty: null, hasRemote: false, originConnected: false, status: "missing" };
    const recoveryEntry = Array.isArray(recovery.projects) ? recovery.projects.find(item => item.name === name) : null;
    const githubEntry = githubRegistry.find(item => item.name === name);
    if (githubEntry?.lastCheckpoint && recoveryEntry?.recoverable) githubCounts.synchronized += 1;
    if (!githubEntry || !exists || !git.isGit) githubCounts.problematic += 1;
    results.push({
      name,
      path: projectPath,
      exists,
      ...git,
      recoveryStatus: recoveryEntry ? (recoveryEntry.recoverable ? "OK" : "требуется sync") : "нет доступа",
      githubStatus: recoveryEntry ? recoveryEntry.githubStatus || recovery.githubStatus : recovery.githubStatus || "unknown"
    });
  }
  return {
    projects: results,
    recovery: {
      lastCheckedAt: recovery.lastCheckedAt || "",
      lastGitHubSync: recovery.lastGitHubSync || "",
      projectsCount: results.length,
      githubStatus: recovery.githubStatus || "unknown",
      githubProjects: githubCounts.projects,
      githubSynchronized: githubCounts.synchronized,
      githubProblematic: githubCounts.problematic
    }
  };
}

async function currentManagedProjects() {
  const latest = await loadConfig();
  const registry = await readRegistry();
  const projectsConfig = await loadProjectsRegistry();
  const configMap = new Map(projectsConfig.map(item => [item.name, item]));
  const roots = latest.readWrite.map(normalizePath);
  const projects = [];
  for (const root of roots) {
    const name = path.basename(root);
    if (MANAGED_PROJECTS.includes(name) || registry[name]) {
      projects.push({ name, path: root, ...configMap.get(name) });
    }
  }
  for (const [name, entry] of Object.entries(registry)) {
    if (!projects.some(project => project.name === name)) {
      projects.push({ name, path: normalizePath(entry.path), ...configMap.get(name) });
    }
  }
  return projects;
}

async function syncProjects(dryRun = false) {
  const projects = [];
  const registry = await readRegistry();
  for (const project of await currentManagedProjects()) {
    const projectPath = normalizePath(project.path);
    const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
    const git = exists ? await gitStatus(projectPath) : { isGit: false, branch: null, lastCommit: null, dirty: null, hasRemote: false, originConnected: false, status: "missing" };
    const remote = exists ? await gitRemoteState(projectPath) : { remote: "", remoteAvailable: false, remoteCommit: null, divergence: "unknown", available: false };
    projects.push({
      name: project.name || path.basename(projectPath),
      path: projectPath,
      type: project.type || (git.isGit ? "git" : "folder"),
      remote: remote.remote || project.remote || "",
      branch: git.branch,
      lastCommit: git.lastCommit,
      localCommit: git.lastCommit,
      remoteCommit: remote.remoteCommit,
      divergence: remote.divergence,
      available: remote.available,
      remoteAvailable: remote.remoteAvailable,
      exists,
      clean: git.status === "clean",
      dirty: git.dirty,
      registeredAt: project.registeredAt || new Date().toISOString(),
      lastCheckpoint: project.lastCheckpoint || "",
      github: {
        remote: remote.remote,
        available: remote.remoteAvailable,
        lastCommit: remote.remoteCommit,
        divergence: remote.divergence
      }
    });
  }

  const payload = { dryRun, projects, count: projects.length };
  if (!dryRun) {
    await saveProjectsConfig({ projects });
    const mirror = Object.fromEntries(projects.map(project => [project.name, { path: project.path, branch: project.branch, lastCommit: project.lastCommit, remote: project.remote, divergence: project.divergence, remoteAvailable: project.remoteAvailable }]));
    await writeRegistry(mirror);
    await logProject("sync", "projects", `${projects.length}`);
  }
  return payload;
}

async function recoveryCheck() {
  const config = await loadProjectsConfig();
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const checks = [];
  for (const project of projects) {
    const exists = await fs.stat(project.path).then(s => s.isDirectory()).catch(() => false);
    const status = exists ? await gitStatus(project.path) : { isGit: false, branch: null, lastCommit: null, dirty: null, hasRemote: false, originConnected: false, status: "missing" };
    const remote = exists ? await gitRemoteState(project.path) : { remote: "", remoteAvailable: false, remoteCommit: null, divergence: "unknown", available: false };
    checks.push({
      name: project.name,
      path: project.path,
      exists,
      branch: status.branch,
      localCommit: status.lastCommit,
      remote: remote.remote,
      remoteCommit: remote.remoteCommit,
      divergence: remote.divergence,
      repositoryAvailable: remote.available && remote.remoteAvailable,
      recoverable: exists && status.isGit && (remote.divergence === "synced" || remote.divergence === "unknown")
    });
  }
  const lastGitHubSync = config.lastGitHubSync || "";
  const githubStatus = checks.some(item => item.repositoryAvailable) ? "available" : "unknown";
  const payload = { ok: checks.every(item => item.recoverable || !item.exists), lastCheckedAt: new Date().toISOString(), lastGitHubSync, githubStatus, checks };
  await saveRecoveryConfig({
    lastCheckedAt: payload.lastCheckedAt,
    projects: checks,
    lastGitHubSync,
    githubStatus
  });
  await fs.appendFile(RECOVERY_LOG, `${payload.lastCheckedAt} | recovery_check | ${checks.length} | ${payload.ok ? "ok" : "needs_attention"}\n`, "utf8");
  return payload;
}

async function projectScan(projectPath, dryRun = false) {
  const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
  const report = {
    path: projectPath,
    dryRun,
    exists,
    packageJson: false,
    readme: false,
    git: false,
    sizeBytes: 0,
    recentChanges: [],
    structureErrors: []
  };

  if (!exists) {
    report.structureErrors.push("project directory is missing");
    return report;
  }

  report.packageJson = await fs.stat(path.join(projectPath, "package.json")).then(s => s.isFile()).catch(() => false);
  report.readme = await fs.readdir(projectPath).then(items => items.some(name => /^readme(\.md|\.txt)?$/i.test(name))).catch(() => false);
  report.git = await fs.stat(path.join(projectPath, ".git")).then(s => s.isFile() || s.isDirectory()).catch(() => false);

  const walk = async dir => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build" || entry.name === "backups" || entry.name === "logs") {
          continue;
        }
        await walk(full);
      } else {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) report.sizeBytes += stat.size;
      }
    }
  };
  await walk(projectPath);

  try {
    const porcelain = await runGit(projectPath, ["status", "--porcelain"]);
    report.recentChanges = porcelain.stdout.trim().split("\n").filter(Boolean).slice(0, 10);
  } catch {}

  if (!report.packageJson) report.structureErrors.push("missing package.json");
  if (!report.readme) report.structureErrors.push("missing README");
  return report;
}

async function safeChange(projectPath, message, dryRun = false) {
  const project = path.basename(projectPath);
  const preview = {
    dryRun,
    projectPath,
    message,
    backupPath: path.join(BACKUPS, archiveName(projectPath))
  };
  if (dryRun) {
    await logAction("safe_change", project, "preview", "dryRun");
    return preview;
  }
  const backup = await archiveProject(projectPath);
  const checkpoint = await gitCheckpoint(projectPath, message, false);
  await logAction("safe_change", project, "backup+checkpoint", "ready");
  return { dryRun: false, projectPath, backup, checkpoint };
}

async function discoverProjects(dryRun = false) {
  const results = [];
  const discovered = [];
  const registered = new Set((await loadProjectsRegistry()).map(item => item.path));
  const roots = await fs.readdir(DISCOVERY_ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of roots) {
    if (!entry.isDirectory()) continue;
    const full = path.join(DISCOVERY_ROOT, entry.name);
    const git = await gitStatus(full);
    const registeredAlready = registered.has(normalizePath(full)) || allowedRootsState.some(root => normalizePath(root) === normalizePath(full));
    const item = { name: entry.name, path: full, isGit: git.isGit, registered: registeredAlready, branch: git.branch, lastCommit: git.lastCommit, hasRemote: git.hasRemote };
    results.push(item);
    if (git.isGit && !registeredAlready) discovered.push(item);
  }
  const payload = { dryRun, root: DISCOVERY_ROOT, discovered, results, suggestedRegistrations: discovered.map(item => ({ name: item.name, path: item.path })) };
  if (!dryRun) {
    await logProject("discover", DISCOVERY_ROOT, `${discovered.length}`);
  }
  return payload;
}

async function projectManager(command, name, projectPath, dryRun = false) {
  const registry = await loadProjectsRegistry();
  const project = name ? registry.find(item => item.name === name) : null;
  const targetPath = projectPath || project?.path || "";
  if (command === "list") {
    return { projects: await currentManagedProjects(), registry };
  }
  if (command === "check") {
    if (!targetPath) throw createError("INVALID_ARGUMENT", "path is required");
    const scan = await projectScan(targetPath, dryRun);
    const status = await gitStatus(targetPath);
    return { projectPath: targetPath, scan, status };
  }
  if (command === "backup") {
    if (!targetPath) throw createError("INVALID_ARGUMENT", "path is required");
    return await backupProjectInfo(targetPath).then(result => ({ dryRun, ...result }));
  }
  if (command === "checkpoint") {
    if (!targetPath) throw createError("INVALID_ARGUMENT", "path is required");
    const message = `Project manager checkpoint ${name || path.basename(targetPath)}`;
    return await gitCheckpoint(targetPath, message, dryRun);
  }
  if (command === "health") {
    if (!targetPath) throw createError("INVALID_ARGUMENT", "path is required");
    const status = await gitStatus(targetPath);
    const scan = await projectScan(targetPath, true);
    return { projectPath: targetPath, status, scan };
  }
  throw createError("INVALID_ARGUMENT", "Unknown project_manager command");
}

async function loadAllowedProjects(config) {
  const allowed = config.readWrite.map(normalizePath);
  const projectMap = new Map();
  for (const projectPath of allowed) {
    const name = path.basename(projectPath);
    if (MANAGED_PROJECTS.includes(name)) projectMap.set(name, projectPath);
  }
  return { allowed, projectMap };
}

await bootstrap();
const config = await loadConfig();
const { allowed, projectMap } = await loadAllowedProjects(config);
refreshAllowedRoots(allowed);
const isAllowed = target => makeRootMatcher(allowedRootsState)(target);
const managedProjects = [...projectMap.entries()].map(([name, projectPath]) => ({ name, path: projectPath }));

const server = new Server({ name: "mcp-clean", version: "1.4.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "ping", description: "РџСЂРѕРІРµСЂРєР° MCP", inputSchema: { type: "object", properties: {} } },
    {
      name: "list_directory",
      description: "РЎРїРёСЃРѕРє С„Р°Р№Р»РѕРІ РІ СЂР°Р·СЂРµС€РµРЅРЅРѕР№ РїР°РїРєРµ",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    },
    {
      name: "read_file",
      description: "Р§С‚РµРЅРёРµ С„Р°Р№Р»Р°",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    },
    {
      name: "write_file",
      description: "Р—Р°РїРёСЃСЊ С„Р°Р№Р»Р° СЃ СЂРµР·РµСЂРІРЅРѕР№ РєРѕРїРёРµР№",
      inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
    },
    {
      name: "project_status",
      description: "РЎРѕСЃС‚РѕСЏРЅРёРµ git-РїСЂРѕРµРєС‚Р° РёР· СЂР°Р·СЂРµС€РµРЅРЅС‹С… РєРѕСЂРЅРµР№",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    },
    {
      name: "backup_project",
      description: "РЎРѕР·РґР°РЅРёРµ zip-Р°СЂС…РёРІР° РїСЂРѕРµРєС‚Р° РІ backups",
      inputSchema: { type: "object", properties: { path: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path"] }
    },
    { name: "health_check", description: "РџСЂРѕРІРµСЂРєР° РіРѕС‚РѕРІРЅРѕСЃС‚Рё MCP-CLEAN", inputSchema: { type: "object", properties: {} } },
    { name: "git_status_all", description: "РЎС‚Р°С‚СѓСЃ git РґР»СЏ РІСЃРµС… РїСЂРѕРµРєС‚РѕРІ РёР· allowed roots", inputSchema: { type: "object", properties: {} } },
    { name: "git_checkpoint", description: "РЎРѕР·РґР°РЅРёРµ git checkpoint СЃ commit Рё push", inputSchema: { type: "object", properties: { message: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["message"] } },
    { name: "restore_project", description: "РћС‚РєР°С‚ РїСЂРѕРµРєС‚Р° Рє РІС‹Р±СЂР°РЅРЅРѕРјСѓ commit", inputSchema: { type: "object", properties: { path: { type: "string" }, commit: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path"] } },
    { name: "system_status", description: "РћРґРЅР° РєРѕРјР°РЅРґР° РґР»СЏ РїСЂРѕРІРµСЂРєРё РІСЃРµР№ СЃРёСЃС‚РµРјС‹ РїСЂРѕРµРєС‚РѕРІ", inputSchema: { type: "object", properties: {} } },
    { name: "project_scan", description: "Р“Р»СѓР±РѕРєР°СЏ РїСЂРѕРІРµСЂРєР° СЃС‚СЂСѓРєС‚СѓСЂС‹ РїСЂРѕРµРєС‚Р°", inputSchema: { type: "object", properties: { path: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path"] } },
    { name: "safe_change", description: "РџРѕРґРіРѕС‚РѕРІРєР° РїРµСЂРµРґ РёР·РјРµРЅРµРЅРёРµРј РїСЂРѕРµРєС‚Р°", inputSchema: { type: "object", properties: { path: { type: "string" }, message: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path", "message"] } },
    { name: "register_project", description: "Р‘РµР·РѕРїР°СЃРЅРѕРµ РґРѕР±Р°РІР»РµРЅРёРµ РЅРѕРІРѕРіРѕ РїСЂРѕРµРєС‚Р° РІ СЃРёСЃС‚РµРјСѓ MCP-CLEAN", inputSchema: { type: "object", properties: { name: { type: "string" }, path: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["name", "path"] } },
    { name: "unregister_project", description: "РЈРґР°Р»РµРЅРёРµ РїСЂРѕРµРєС‚Р° РёР· РєРѕРЅС‚СЂРѕР»СЏ MCP Р±РµР· СѓРґР°Р»РµРЅРёСЏ С„Р°Р№Р»РѕРІ", inputSchema: { type: "object", properties: { name: { type: "string" }, path: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["name", "path"] } }
    ,{ name: "project_manager", description: "РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРёР№ РјРµРЅРµРґР¶РµСЂ РїСЂРѕРµРєС‚РѕРІ", inputSchema: { type: "object", properties: { command: { type: "string" }, name: { type: "string" }, path: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["command"] } }
    ,{ name: "discover_projects", description: "РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РѕР±РЅР°СЂСѓР¶РµРЅРёРµ РЅРѕРІС‹С… РїСЂРѕРµРєС‚РѕРІ", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "github_status", description: "GitHub-статус проекта: remote, commit, branch, divergence, availability", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }
    ,{ name: "sync_projects", description: "Синхронизация registry MCP-CLEAN и GitHub-ориентированных метаданных", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "recovery_check", description: "Проверка готовности проектов к восстановлению из registry и GitHub", inputSchema: { type: "object", properties: {} } }
    ,{ name: "github_status_all", description: "Единый статус всех GitHub-проектов", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "github_checkpoint_all", description: "Массовая точка сохранения всех проектов", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "github_sync_check", description: "Проверка расхождений local/remote без merge", inputSchema: { type: "object", properties: { path: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path"] } }
    ,{ name: "browser_status", description: "Статус Edge браузера и управляемого профиля", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "browser_tabs", description: "Список сохранённых вкладок браузера", inputSchema: { type: "object", properties: {} } }
    ,{ name: "browser_open", description: "Открытие URL в существующем Edge", inputSchema: { type: "object", properties: { url: { type: "string" }, newTab: { type: "boolean", default: true } }, required: ["url"] } }
    ,{ name: "browser_checkpoint", description: "Сохранение состояния браузера", inputSchema: { type: "object", properties: {} } }
    ,{ name: "browser_restore", description: "Восстановление сохранённого состояния браузера", inputSchema: { type: "object", properties: {} } }
    ,{ name: "crm_status", description: "Проверка состояния CRM", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "crm_api_check", description: "Проверка CRM API /health", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "crm_leads_check", description: "Проверка лидов CRM", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "crm_checkpoint", description: "CRM checkpoint через backup и git checkpoint", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "deploy_status", description: "Статус сайтов и deploy state", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "deploy_check", description: "Проверка доступности сайта и HTTPS", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "deploy_prepare", description: "Подготовка к deploy через backup и checkpoint", inputSchema: { type: "object", properties: { dryRun: { type: "boolean", default: false } } } }
    ,{ name: "deploy_history", description: "История последних публикаций", inputSchema: { type: "object", properties: {} } }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const { name } = request.params;
    const args = request.params.arguments || {};

    if (name === "ping") return { content: [{ type: "text", text: "MCP CLEAN READY" }] };

    if (name === "list_directory") {
      const directory = assertAllowed(args.path, isAllowed);
      const files = await fs.readdir(directory, { withFileTypes: true });
      return { content: [{ type: "text", text: files.map(file => `${file.isDirectory() ? "[DIR]" : "[FILE]"} ${file.name}`).join("\n") }] };
    }

    if (name === "read_file") {
      const filePath = assertAllowed(args.path, isAllowed);
      return { content: [{ type: "text", text: await fs.readFile(filePath, "utf8") }] };
    }

    if (name === "write_file") {
      const filePath = assertAllowed(args.path, isAllowed);
      try {
        const oldContent = await fs.readFile(filePath, "utf8");
        await fs.writeFile(path.join(BACKUPS, backupName(filePath)), oldContent, "utf8");
        await logAction("write_file", path.basename(path.dirname(filePath)), "backup", "created");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await fs.writeFile(filePath, args.content, "utf8");
      await logAction("write_file", path.basename(path.dirname(filePath)), "write", "ok");
      return { content: [{ type: "text", text: "WRITE OK" }] };
    }

    if (name === "project_status") {
      const projectPath = assertAllowed(args.path, isAllowed);
      return { content: [{ type: "text", text: normalizeToolResult(await gitStatus(projectPath)) }] };
    }

    if (name === "backup_project") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
      if (!exists) throw createError("NOT_FOUND", "Project path does not exist or is not a directory", { path: projectPath });
      if (args.dryRun) {
        return { content: [{ type: "text", text: normalizeToolResult({ dryRun: true, projectPath, archivePath: path.join(BACKUPS, archiveName(projectPath)), projectInfo: { name: path.basename(projectPath) } }) }] };
      }
      const info = await backupProjectInfo(projectPath);
      await logAction("backup_project", path.basename(projectPath), "archive", info.archivePath);
      return { content: [{ type: "text", text: normalizeToolResult(info) }] };
    }

    if (name === "health_check") {
      const checks = {
        allowedRootsConfig: await fs.stat(CONFIG).then(s => s.isFile()).catch(() => false),
        logs: await fs.stat(LOGS).then(s => s.isDirectory()).catch(() => false),
        backups: await fs.stat(BACKUPS).then(s => s.isDirectory()).catch(() => false),
        exchange: await fs.stat(EXCHANGE).then(s => s.isDirectory()).catch(() => false),
        serverMjs: await fs.stat(path.join(ROOT, "server.mjs")).then(s => s.isFile()).catch(() => false),
        gitAvailable: await gitAvailable(),
        remoteAvailable: (await gitStatus(ROOT)).hasRemote,
        actionsLog: await fs.stat(ACTIONS_LOG).then(s => s.isFile()).catch(() => false),
        toolsAvailable: true
      };
      return { content: [{ type: "text", text: normalizeToolResult({ ok: checks.allowedRootsConfig && checks.logs && checks.backups && checks.exchange && checks.serverMjs && checks.gitAvailable && checks.toolsAvailable, checks }) }] };
    }

    if (name === "git_status_all") {
      const status = await systemStatus(managedProjects);
      return { content: [{ type: "text", text: normalizeToolResult({ projects: status.projects }) }] };
    }

    if (name === "git_checkpoint") {
      const message = String(args.message || "").trim();
      if (!message) throw createError("INVALID_ARGUMENT", "message is required");
      const result = await gitCheckpoint(ROOT, message, Boolean(args.dryRun));
      return { content: [{ type: "text", text: normalizeToolResult(result) }] };
    }

    if (name === "restore_project") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const checkpoints = await listGitCheckpoints(projectPath);
      if (!args.commit) {
        return { content: [{ type: "text", text: normalizeToolResult({ projectPath, checkpoints }) }] };
      }
      const commit = String(args.commit).trim();
      if (!checkpoints.some(c => c.full.startsWith(commit) || c.short === commit)) {
        throw createError("INVALID_ARGUMENT", "Selected commit is not in recent checkpoint list", { commit });
      }
      const restored = await restoreCommit(projectPath, commit, Boolean(args.dryRun));
      return { content: [{ type: "text", text: normalizeToolResult({ projectPath, checkpoints, restored }) }] };
    }

    if (name === "system_status") {
      return { content: [{ type: "text", text: normalizeToolResult(await systemStatus(await currentManagedProjects())) }] };
    }

    if (name === "project_scan") {
      const projectPath = assertAllowed(args.path, isAllowed);
      return { content: [{ type: "text", text: normalizeToolResult(await projectScan(projectPath, Boolean(args.dryRun))) }] };
    }

    if (name === "safe_change") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const message = String(args.message || "").trim();
      if (!message) throw createError("INVALID_ARGUMENT", "message is required");
      const result = await safeChange(projectPath, message, Boolean(args.dryRun));
      return { content: [{ type: "text", text: normalizeToolResult(result) }] };
    }

    if (name === "register_project") {
      const projectName = String(args.name || "").trim();
      const projectPath = assertAllowed(args.path, isAllowed);
      if (!projectName) throw createError("INVALID_ARGUMENT", "name is required");
      const result = await registerProject(projectName, projectPath, Boolean(args.dryRun));
      return { content: [{ type: "text", text: normalizeToolResult(result) }] };
    }

    if (name === "unregister_project") {
      const projectName = String(args.name || "").trim();
      const projectPath = assertAllowed(args.path, isAllowed);
      if (!projectName) throw createError("INVALID_ARGUMENT", "name is required");
      const result = await unregisterProject(projectName, projectPath, Boolean(args.dryRun));
      return { content: [{ type: "text", text: normalizeToolResult(result) }] };
    }

    if (name === "project_manager") {
      const command = String(args.command || "").trim();
      const result = await projectManager(command, String(args.name || "").trim(), args.path ? String(args.path) : "", Boolean(args.dryRun));
      return { content: [{ type: "text", text: normalizeToolResult(result) }] };
    }

    if (name === "discover_projects") {
      return { content: [{ type: "text", text: normalizeToolResult(await discoverProjects(Boolean(args.dryRun))) }] };
    }

    if (name === "github_status") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const result = await gitRemoteState(projectPath);
      return { content: [{ type: "text", text: normalizeToolResult({ path: projectPath, ...result }) }] };
    }

    if (name === "sync_projects") {
      return { content: [{ type: "text", text: normalizeToolResult(await syncProjects(Boolean(args.dryRun))) }] };
    }

    if (name === "recovery_check") {
      return { content: [{ type: "text", text: normalizeToolResult(await recoveryCheck()) }] };
    }

    if (name === "sync_project_state") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const result = await syncProjectState(projectPath);
      return { content: [{ type: "text", text: normalizeToolResult({ dryRun: Boolean(args.dryRun), ...result }) }] };
    }

    if (name === "github_status_all") {
      return { content: [{ type: "text", text: normalizeToolResult(await githubStatusAll(Boolean(args.dryRun))) }] };
    }

    if (name === "github_checkpoint_all") {
      return { content: [{ type: "text", text: normalizeToolResult(await githubCheckpointAll(Boolean(args.dryRun))) }] };
    }

    if (name === "github_sync_check") {
      const projectPath = assertAllowed(args.path, isAllowed);
      return { content: [{ type: "text", text: normalizeToolResult(await githubSyncCheck(projectPath, Boolean(args.dryRun))) }] };
    }

    if (name === "browser_status") {
      return { content: [{ type: "text", text: normalizeToolResult({ dryRun: Boolean(args.dryRun), ...(await browserStatusInfo()) }) }] };
    }

    if (name === "browser_tabs") {
      return { content: [{ type: "text", text: normalizeToolResult(await browserTabsInfo()) }] };
    }

    if (name === "browser_open") {
      const url = String(args.url || "").trim();
      if (!url) throw createError("INVALID_ARGUMENT", "url is required");
      return { content: [{ type: "text", text: normalizeToolResult(await browserOpenUrl(url, Boolean(args.newTab))) }] };
    }

    if (name === "browser_checkpoint") {
      return { content: [{ type: "text", text: normalizeToolResult(await browserCheckpoint()) }] };
    }

    if (name === "browser_restore") {
      return { content: [{ type: "text", text: normalizeToolResult(await browserRestore()) }] };
    }

    if (name === "crm_status") {
      return { content: [{ type: "text", text: normalizeToolResult(await crmStatus(Boolean(args.dryRun))) }] };
    }

    if (name === "crm_api_check") {
      return { content: [{ type: "text", text: normalizeToolResult(await crmApiCheck(Boolean(args.dryRun))) }] };
    }

    if (name === "crm_leads_check") {
      return { content: [{ type: "text", text: normalizeToolResult(await crmLeadsCheck(Boolean(args.dryRun))) }] };
    }

    if (name === "crm_checkpoint") {
      return { content: [{ type: "text", text: normalizeToolResult(await crmCheckpoint(Boolean(args.dryRun))) }] };
    }

    if (name === "deploy_status") {
      return { content: [{ type: "text", text: normalizeToolResult(await deployStatus(Boolean(args.dryRun))) }] };
    }

    if (name === "deploy_check") {
      return { content: [{ type: "text", text: normalizeToolResult(await deployCheck(Boolean(args.dryRun))) }] };
    }

    if (name === "deploy_prepare") {
      return { content: [{ type: "text", text: normalizeToolResult(await deployPrepare(Boolean(args.dryRun))) }] };
    }

    if (name === "deploy_history") {
      return { content: [{ type: "text", text: normalizeToolResult(await deployHistory()) }] };
    }

    throw createError("UNKNOWN_TOOL", "Unknown tool");
  } catch (error) {
    return toErrorResult(error);
  }
});

await server.connect(new StdioServerTransport());
console.error("MCP CLEAN READY");




