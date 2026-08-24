import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const ROOT = "F:\\MCP-CLEAN";
const CONFIG = path.join(ROOT, "config", "allowed-roots.json");
const BACKUPS = path.join(ROOT, "backups");
const LOGS = path.join(ROOT, "logs");
const TEMP = path.join(ROOT, "temp");
const EXCHANGE = path.join(ROOT, "exchange");
const GIT_CANDIDATES = [
  "git",
  "C:\\Program Files\\Git\\cmd\\git.exe",
  "C:\\Program Files\\Git\\bin\\git.exe"
];
const PROJECT_NAMES = [
  "CRM",
  "CRM-Mobile-2",
  "MBA-ALBUMS",
  "mba-academy-site",
  "Site-universe",
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
}

function normalizePath(target) {
  return path.resolve(target);
}

function isWithinRoot(target, root) {
  const full = normalizePath(target);
  const base = normalizePath(root);
  const relative = path.relative(base, full);
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
    content: [
      {
        type: "text",
        text: `${error.code || "ERROR"}: ${error.message || "Unknown error"}`
      }
    ]
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupName(filePath) {
  return `${path.basename(filePath)}.${timestamp()}.bak`;
}

function archiveName(projectPath) {
  return `${path.basename(projectPath)}.${timestamp()}.zip`;
}

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG, "utf8");
    const config = JSON.parse(raw);
    if (!Array.isArray(config?.readWrite)) {
      throw createError("CONFIG_ERROR", "allowed-roots.json must contain readWrite array");
    }
    return config;
  } catch (error) {
    throw createError("CONFIG_ERROR", `Failed to load ${CONFIG}: ${error.message}`);
  }
}

function makeRootMatcher(allowedRoots) {
  const normalizedRoots = allowedRoots.map(normalizePath);
  return target => normalizedRoots.some(root => isWithinRoot(target, root));
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
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
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
    result.status = "unknown";
  }

  try {
    const remotes = await runGit(projectPath, ["remote"]);
    result.hasRemote = remotes.stdout.trim().length > 0;
  } catch {
    result.hasRemote = false;
  }

  return result;
}

async function listGitCheckpoints(projectPath, limit = 12) {
  try {
    const result = await runGit(projectPath, [
      "log",
      `--max-count=${limit}`,
      "--pretty=format:%H|%h|%s|%cI"
    ]);
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
  const archive = path.join(BACKUPS, archiveName(projectPath));
  const archiveDir = path.dirname(archive);
  await fs.mkdir(archiveDir, { recursive: true });
  const sourceRoot = path.join(projectPath, "*");
  await runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path "${sourceRoot}" -DestinationPath "${archive}" -Force`
    ],
    ROOT
  );
  const stat = await fs.stat(archive);
  return {
    archivePath: archive,
    projectPath,
    sizeBytes: stat.size
  };
}

async function backupProjectInfo(projectPath) {
  const info = await archiveProject(projectPath);
  const existing = await fs.readdir(BACKUPS).catch(() => []);
  return {
    ...info,
    backups: existing.filter(name => name.toLowerCase().endsWith(".zip"))
  };
}

async function log(message) {
  await fs.appendFile(
    path.join(LOGS, "mcp-clean.log"),
    `${new Date().toISOString()} ${message}\n`,
    "utf8"
  );
}

async function restoreCommit(projectPath, commit, dryRun = false) {
  const before = await gitStatus(projectPath);
  const checkpoint = await archiveProject(projectPath);
  if (dryRun) {
    return { dryRun: true, before, checkpoint, commit };
  }
  await runGit(projectPath, ["reset", "--hard", commit]);
  return { dryRun: false, before, checkpoint, commit, after: await gitStatus(projectPath) };
}

await bootstrap();

const config = await loadConfig();
const isAllowed = makeRootMatcher(config.readWrite);
const allowedProjects = config.readWrite
  .map(normalizePath)
  .filter(root => PROJECT_NAMES.includes(path.basename(root)));

const server = new Server(
  {
    name: "mcp-clean",
    version: "1.3.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "ping", description: "Проверка MCP", inputSchema: { type: "object", properties: {} } },
    {
      name: "list_directory",
      description: "Список файлов в разрешенной папке",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"]
      }
    },
    {
      name: "read_file",
      description: "Чтение файла",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"]
      }
    },
    {
      name: "write_file",
      description: "Запись файла с резервной копией",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    },
    {
      name: "project_status",
      description: "Состояние git-проекта из разрешенных корней",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"]
      }
    },
    {
      name: "backup_project",
      description: "Создание zip-архива проекта в backups",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          dryRun: { type: "boolean", default: false }
        },
        required: ["path"]
      }
    },
    {
      name: "health_check",
      description: "Проверка готовности MCP-CLEAN",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "git_status_all",
      description: "Статус git для всех проектов из allowed roots",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "git_checkpoint",
      description: "Создание git checkpoint с commit и push",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          dryRun: { type: "boolean", default: false }
        },
        required: ["message"]
      }
    },
    {
      name: "restore_project",
      description: "Откат проекта к выбранному commit",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          commit: { type: "string" },
          dryRun: { type: "boolean", default: false }
        },
        required: ["path"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const { name } = request.params;
    const args = request.params.arguments || {};

    if (name === "ping") {
      return { content: [{ type: "text", text: "MCP CLEAN READY" }] };
    }

    if (name === "list_directory") {
      const directory = assertAllowed(args.path, isAllowed);
      const files = await fs.readdir(directory, { withFileTypes: true });
      return { content: [{ type: "text", text: files.map(file => `${file.isDirectory() ? "[DIR]" : "[FILE]"} ${file.name}`).join("\n") }] };
    }

    if (name === "read_file") {
      const filePath = assertAllowed(args.path, isAllowed);
      const data = await fs.readFile(filePath, "utf8");
      return { content: [{ type: "text", text: data }] };
    }

    if (name === "write_file") {
      const filePath = assertAllowed(args.path, isAllowed);
      try {
        const oldContent = await fs.readFile(filePath, "utf8");
        await fs.writeFile(path.join(BACKUPS, backupName(filePath)), oldContent, "utf8");
        const backups = await fs.readdir(BACKUPS).catch(() => []);
        await log(`FILE_BACKUP ${filePath} ${backups.length}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await fs.writeFile(filePath, args.content, "utf8");
      await log(`WRITE ${filePath}`);
      return { content: [{ type: "text", text: "WRITE OK" }] };
    }

    if (name === "project_status") {
      const projectPath = assertAllowed(args.path, isAllowed);
      return { content: [{ type: "text", text: JSON.stringify(await gitStatus(projectPath), null, 2) }] };
    }

    if (name === "backup_project") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
      if (!exists) {
        throw createError("NOT_FOUND", "Project path does not exist or is not a directory", { path: projectPath });
      }
      if (args.dryRun) {
        const archivePath = path.join(BACKUPS, archiveName(projectPath));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  dryRun: true,
                  projectPath,
                  archivePath,
                  projectInfo: {
                    name: path.basename(projectPath),
                    sizeBytes: null
                  }
                },
                null,
                2
              )
            }
          ]
        };
      }
      const info = await backupProjectInfo(projectPath);
      const existing = await fs.readdir(BACKUPS).catch(() => []);
      await log(`BACKUP ${projectPath} -> ${info.archivePath}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                dryRun: false,
                projectPath,
                archivePath: info.archivePath,
                sizeBytes: info.sizeBytes,
                backups: existing.filter(name => name.toLowerCase().endsWith(".zip")),
                projectInfo: {
                  name: path.basename(projectPath)
                }
              },
              null,
              2
            )
          }
        ]
      };
    }

    if (name === "health_check") {
      const checks = {
        allowedRootsConfig: false,
        logs: false,
        backups: false,
        exchange: false,
        serverMjs: false,
        gitAvailable: false,
        remoteAvailable: false,
        toolsAvailable: false
      };

      checks.allowedRootsConfig = await fs.stat(CONFIG).then(s => s.isFile()).catch(() => false);
      checks.logs = await fs.stat(LOGS).then(s => s.isDirectory()).catch(() => false);
      checks.backups = await fs.stat(BACKUPS).then(s => s.isDirectory()).catch(() => false);
      checks.exchange = await fs.stat(EXCHANGE).then(s => s.isDirectory()).catch(() => false);
      checks.serverMjs = await fs.stat(path.join(ROOT, "server.mjs")).then(s => s.isFile()).catch(() => false);
      checks.gitAvailable = await gitAvailable();
      checks.remoteAvailable = (await gitStatus(ROOT)).hasRemote;
      checks.toolsAvailable = true;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok:
                  checks.allowedRootsConfig &&
                  checks.logs &&
                  checks.backups &&
                  checks.exchange &&
                  checks.serverMjs &&
                  checks.gitAvailable &&
                  checks.toolsAvailable,
                checks
              },
              null,
              2
            )
          }
        ]
      };
    }

    if (name === "git_status_all") {
      const projects = allowedProjects;
      const results = [];
      for (const projectPath of projects) {
        results.push(await gitStatus(projectPath));
      }
      return { content: [{ type: "text", text: JSON.stringify({ projects: results }, null, 2) }] };
    }

    if (name === "git_checkpoint") {
      const message = String(args.message || "").trim();
      if (!message) throw createError("INVALID_ARGUMENT", "message is required");
      const dryRun = Boolean(args.dryRun);
      const statusBefore = await runGit(ROOT, ["status", "--porcelain"]).then(r => r.stdout.trim()).catch(() => "");
      const result = {
        dryRun,
        statusBefore,
        message,
        commitHash: null,
        push: dryRun ? "dry-run" : "not-run"
      };
      if (dryRun) {
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      await runGit(ROOT, ["add", "--", "."]);
      const commit = await runGit(ROOT, ["commit", "-m", message]);
      const hash = await runGit(ROOT, ["rev-parse", "--short", "HEAD"]);
      result.commitHash = hash.stdout.trim();
      try {
        await runGit(ROOT, ["push", "origin", "main"]);
        result.push = "ok";
      } catch (error) {
        result.push = `failed: ${error.message}`;
      }
      result.statusBefore = statusBefore;
      await log(`CHECKPOINT ${result.commitHash} ${message}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "restore_project") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const checkpoint = args.commit ? String(args.commit).trim() : "";
      const checkpoints = await listGitCheckpoints(projectPath);
      if (!checkpoint) {
        return { content: [{ type: "text", text: JSON.stringify({ projectPath, checkpoints }, null, 2) }] };
      }
      const exists = checkpoints.some(c => c.full.startsWith(checkpoint) || c.short === checkpoint);
      if (!exists) throw createError("INVALID_ARGUMENT", "Selected commit is not in recent checkpoint list", { checkpoint });
      const restored = await restoreCommit(projectPath, checkpoint, Boolean(args.dryRun));
      return { content: [{ type: "text", text: JSON.stringify({ projectPath, checkpoints, restored }, null, 2) }] };
    }

    throw createError("UNKNOWN_TOOL", "Unknown tool");
  } catch (error) {
    return toErrorResult(error);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP CLEAN READY");
