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
  if (data !== undefined) {
    error.data = data;
  }
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

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function runGit(cwd, args) {
  const command = await resolveGitCommand();

  return await new Promise((resolve, reject) => {
    const child = spawn(command, ["-C", cwd, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const err = new Error(stderr.trim() || `git exited with code ${code}`);
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
    if (candidate === "git") {
      return candidate;
    }

    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  return "git";
}

async function gitStatus(projectPath) {
  const result = {
    path: projectPath,
    isGit: false,
    branch: null,
    lastCommit: null,
    dirty: null,
    status: "unknown"
  };

  try {
    await runGit(projectPath, ["rev-parse", "--show-toplevel"]);
    result.isGit = true;
  } catch {
    const gitEntry = path.join(projectPath, ".git");
    try {
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
    const dirty = porcelain.stdout.trim().length > 0;
    result.dirty = dirty;
    result.status = dirty ? "modified" : "clean";
  } catch {
    result.dirty = null;
    result.status = "unknown";
  }

  return result;
}

async function archiveProject(projectPath) {
  const archive = path.join(BACKUPS, archiveName(projectPath));
  const parent = path.dirname(projectPath);
  const base = path.basename(projectPath);
  const result = await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path "${path.join(projectPath, "*")}" -DestinationPath "${archive}" -Force`
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve({ archive, base, parent });
      } else {
        const err = new Error(stderr.trim() || `backup failed with code ${code}`);
        err.code = code;
        reject(err);
      }
    });
  });

  return result;
}

async function log(message) {
  await fs.appendFile(path.join(LOGS, "mcp-clean.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
}

await bootstrap();

const config = await loadConfig();
const isAllowed = makeRootMatcher(config.readWrite);

const server = new Server(
  {
    name: "mcp-clean",
    version: "1.2.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ping",
      description: "Проверка MCP",
      inputSchema: { type: "object", properties: {} }
    },
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
        properties: {
          path: { type: "string" }
        },
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
      inputSchema: {
        type: "object",
        properties: {}
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
      return {
        content: [
          {
            type: "text",
            text: files.map(file => `${file.isDirectory() ? "[DIR]" : "[FILE]"} ${file.name}`).join("\n")
          }
        ]
      };
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
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
      await fs.writeFile(filePath, args.content, "utf8");
      await log(`WRITE ${filePath}`);
      return { content: [{ type: "text", text: "WRITE OK" }] };
    }

    if (name === "project_status") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const status = await gitStatus(projectPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2)
          }
        ]
      };
    }

    if (name === "backup_project") {
      const projectPath = assertAllowed(args.path, isAllowed);
      const exists = await fs.stat(projectPath).then(s => s.isDirectory()).catch(() => false);
      if (!exists) {
        throw createError("NOT_FOUND", "Project path does not exist or is not a directory", { path: projectPath });
      }

      const dryRun = Boolean(args.dryRun);
      const archivePath = path.join(BACKUPS, archiveName(projectPath));
      if (dryRun) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  dryRun: true,
                  projectPath,
                  archivePath
                },
                null,
                2
              )
            }
          ]
        };
      }

      const result = await archiveProject(projectPath);
      await log(`BACKUP ${projectPath} -> ${result.archive}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                dryRun: false,
                projectPath,
                archivePath: result.archive
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
        tools: false
      };

      checks.allowedRootsConfig = await fs.stat(CONFIG).then(s => s.isFile()).catch(() => false);
      checks.logs = await fs.stat(LOGS).then(s => s.isDirectory()).catch(() => false);
      checks.backups = await fs.stat(BACKUPS).then(s => s.isDirectory()).catch(() => false);
      checks.exchange = await fs.stat(EXCHANGE).then(s => s.isDirectory()).catch(() => false);
      checks.serverMjs = await fs.stat(path.join(ROOT, "server.mjs")).then(s => s.isFile()).catch(() => false);
      checks.tools = ["ping", "list_directory", "read_file", "write_file", "project_status", "backup_project", "health_check"].length > 0;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: Object.values(checks).every(Boolean),
                checks
              },
              null,
              2
            )
          }
        ]
      };
    }

    throw createError("UNKNOWN_TOOL", "Unknown tool");
  } catch (error) {
    return toErrorResult(error);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP CLEAN READY");
