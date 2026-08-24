import path from "path";
import os from "os";
import fs from "fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = "F:\\MCP-CLEAN";
const serverPath = path.join(root, "server.mjs");
const allowedFile = path.join(root, "package.json");
const projectPath = root;
const forbiddenFile = path.join(os.homedir(), "Desktop", "forbidden-mcp-clean-test.txt");

function fail(message) {
  throw new Error(message);
}

async function callJson(client, name, arguments_) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return JSON.parse(String(result.content?.[0]?.text || "{}"));
}

async function main() {
  await fs.access(allowedFile);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root
  });

  const client = new Client({
    name: "mcp-clean-smoke",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);

    const ping = await client.callTool({ name: "ping", arguments: {} });
    if (!String(ping.content?.[0]?.text || "").includes("READY")) {
      fail("ping did not return READY");
    }

    const health = await callJson(client, "health_check", {});
    if (!health.ok) {
      fail("health_check reported not ok");
    }

    const status = await callJson(client, "project_status", { path: projectPath });
    if (status.path !== projectPath || status.isGit !== true) {
      fail("project_status returned unexpected result");
    }

    const all = await callJson(client, "git_status_all", {});
    if (!Array.isArray(all.projects) || all.projects.length < 2) {
      fail("git_status_all returned unexpected result");
    }

    const backupPreview = await callJson(client, "backup_project", { path: projectPath, dryRun: true });
    if (!backupPreview.dryRun || backupPreview.projectPath !== projectPath) {
      fail("backup_project dryRun returned unexpected result");
    }

    const checkpointPreview = await callJson(client, "git_checkpoint", { message: "smoke checkpoint", dryRun: true });
    if (!checkpointPreview.dryRun || checkpointPreview.message !== "smoke checkpoint") {
      fail("git_checkpoint dryRun returned unexpected result");
    }

    const denied = await client.callTool({ name: "read_file", arguments: { path: forbiddenFile } });
    const deniedText = String(denied.content?.[0]?.text || "");
    if (!denied.isError || !deniedText.includes("ACCESS_DENIED")) {
      fail("forbidden path was not rejected as expected");
    }

    console.log("SMOKE TEST OK");
  } finally {
    try {
      await client.close();
    } catch {}
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
