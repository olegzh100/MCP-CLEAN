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

    const health = await client.callTool({ name: "health_check", arguments: {} });
    const healthJson = JSON.parse(String(health.content?.[0]?.text || "{}"));
    if (!healthJson.ok) {
      fail("health_check reported not ok");
    }

    const status = await client.callTool({
      name: "project_status",
      arguments: { path: projectPath }
    });
    const statusJson = JSON.parse(String(status.content?.[0]?.text || "{}"));
    if (statusJson.path !== projectPath) {
      fail("project_status returned unexpected path");
    }
    if (statusJson.isGit !== true) {
      fail("project_status did not detect git");
    }

    const backupPreview = await client.callTool({
      name: "backup_project",
      arguments: { path: projectPath, dryRun: true }
    });
    const backupJson = JSON.parse(String(backupPreview.content?.[0]?.text || "{}"));
    if (!backupJson.dryRun || backupJson.projectPath !== projectPath) {
      fail("backup_project dryRun returned unexpected result");
    }
    if (!String(backupJson.archivePath || "").includes("backups")) {
      fail("backup_project dryRun did not target backups");
    }

    const denied = await client.callTool({
      name: "read_file",
      arguments: { path: forbiddenFile }
    });

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
