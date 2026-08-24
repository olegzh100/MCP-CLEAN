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
    fs.mkdir(EXCHANGE, { recursive: true })
  ]);
  await fs.appendFile(ACTIONS_LOG, "", "utf8");
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

function makeRootMatcher(allowedRoots) {
  const roots = allowedRoots.map(normalizePath);
  return target => roots.some(root => isWithinRoot(target, root));
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
  return await runCommand(command, ["-C", cwd, ...args], ROOT);
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

async function restoreCommit(projectPath, commit, dryRun = false) {
  const before = await gitStatus(projectPath);
  const checkpoint = await archiveProject(projectPath);
  if (dryRun) return { dryRun: true, before, checkpoint, commit };
  await runGit(projectPath, ["reset", "--hard", commit]);
  return { dryRun: false, before, checkpoint, commit, after: await gitStatus(projectPath) };
}

async function systemStatus(projects) {
  const results = [];
  for (const { name, path: projectPath } of projects) {
    const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
    const git = exists ? await gitStatus(projectPath) : { isGit: false, branch: null, lastCommit: null, dirty: null, hasRemote: false, originConnected: false, status: "missing" };
    results.push({ name, path: projectPath, exists, ...git });
  }
  return results;
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
const isAllowed = makeRootMatcher(allowed);
const managedProjects = [...projectMap.entries()].map(([name, projectPath]) => ({ name, path: projectPath }));

const server = new Server({ name: "mcp-clean", version: "1.4.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "ping", description: "Проверка MCP", inputSchema: { type: "object", properties: {} } },
    {
      name: "list_directory",
      description: "Список файлов в разрешенной папке",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    },
    {
      name: "read_file",
      description: "Чтение файла",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    },
    {
      name: "write_file",
      description: "Запись файла с резервной копией",
      inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
    },
    {
      name: "project_status",
      description: "Состояние git-проекта из разрешенных корней",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    },
    {
      name: "backup_project",
      description: "Создание zip-архива проекта в backups",
      inputSchema: { type: "object", properties: { path: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path"] }
    },
    { name: "health_check", description: "Проверка готовности MCP-CLEAN", inputSchema: { type: "object", properties: {} } },
    { name: "git_status_all", description: "Статус git для всех проектов из allowed roots", inputSchema: { type: "object", properties: {} } },
    { name: "git_checkpoint", description: "Создание git checkpoint с commit и push", inputSchema: { type: "object", properties: { message: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["message"] } },
    { name: "restore_project", description: "Откат проекта к выбранному commit", inputSchema: { type: "object", properties: { path: { type: "string" }, commit: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path"] } },
    { name: "system_status", description: "Одна команда для проверки всей системы проектов", inputSchema: { type: "object", properties: {} } },
    { name: "project_scan", description: "Глубокая проверка структуры проекта", inputSchema: { type: "object", properties: { path: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path"] } },
    { name: "safe_change", description: "Подготовка перед изменением проекта", inputSchema: { type: "object", properties: { path: { type: "string" }, message: { type: "string" }, dryRun: { type: "boolean", default: false } }, required: ["path", "message"] } }
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
      const projects = await systemStatus(managedProjects);
      return { content: [{ type: "text", text: normalizeToolResult({ projects }) }] };
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
      return { content: [{ type: "text", text: normalizeToolResult({ projects: await systemStatus(managedProjects) }) }] };
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

    throw createError("UNKNOWN_TOOL", "Unknown tool");
  } catch (error) {
    return toErrorResult(error);
  }
});

await server.connect(new StdioServerTransport());
console.error("MCP CLEAN READY");
