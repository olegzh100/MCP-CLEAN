import path from "path";
import os from "os";
import fs from "fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = "F:\\MCP-CLEAN";
const serverPath = path.join(root, "server.mjs");
const allowedFile = path.join(root, "package.json");
const forbiddenFile = path.join(os.homedir(), "Desktop", "forbidden-mcp-clean-test.txt");
const tempProject = path.join(root, "temp", "registry-smoke-project");
const tempProjectName = "registry-smoke-project";

function fail(message) {
  throw new Error(message);
}

function parseToolJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Expected JSON, got: ${raw.slice(0, 120)}`);
  }
  return JSON.parse(raw.slice(start, end + 1));
}

async function callJson(client, name, arguments_) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return parseToolJson(result.content?.[0]?.text || "{}");
}

async function main() {
  await fs.access(allowedFile);
  await fs.mkdir(tempProject, { recursive: true });
  await fs.writeFile(
    path.join(tempProject, "README.md"),
    "# registry smoke project\n",
    "utf8"
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root
  });

  const client = new Client({ name: "mcp-clean-smoke", version: "1.0.0" });

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

    const system = await callJson(client, "system_status", {});
    if (!Array.isArray(system.projects) || system.projects.length < 7 || !system.recovery) {
      fail("system_status returned unexpected result");
    }

    const scan = await callJson(client, "project_scan", { path: root, dryRun: true });
    if (scan.path !== root || scan.dryRun !== true) {
      fail("project_scan dryRun returned unexpected result");
    }

    const safe = await callJson(client, "safe_change", { path: root, message: "smoke safe change", dryRun: true });
    if (!safe.dryRun || safe.projectPath !== root) {
      fail("safe_change dryRun returned unexpected result");
    }

    const status = await callJson(client, "project_status", { path: root });
    if (status.path !== root || status.isGit !== true) {
      fail("project_status returned unexpected result");
    }

    const all = await callJson(client, "git_status_all", {});
    if (!Array.isArray(all.projects) || all.projects.length < 7) {
      fail("git_status_all returned unexpected result");
    }

    const managerList = await callJson(client, "project_manager", { command: "list" });
    if (!Array.isArray(managerList.projects) || managerList.projects.length < 1) {
      fail("project_manager list returned unexpected result");
    }

    const discovery = await callJson(client, "discover_projects", { dryRun: true });
    if (discovery.dryRun !== true || discovery.root !== "C:\\Users\\oleg\\codex-test") {
      fail("discover_projects dryRun returned unexpected result");
    }

    const githubStatus = await callJson(client, "github_status", { path: root });
    if (githubStatus.path !== root || typeof githubStatus.available !== "boolean") {
      fail("github_status returned unexpected result");
    }

    const syncPreview = await callJson(client, "sync_projects", { dryRun: true });
    if (syncPreview.dryRun !== true || !Array.isArray(syncPreview.projects)) {
      fail("sync_projects dryRun returned unexpected result");
    }

    const recovery = await callJson(client, "recovery_check", {});
    if (!Array.isArray(recovery.checks) || typeof recovery.ok !== "boolean") {
      fail("recovery_check returned unexpected result");
    }

    const githubAllPreview = await callJson(client, "github_status_all", { dryRun: true });
    if (!githubAllPreview.dryRun || !Array.isArray(githubAllPreview.projects)) {
      fail("github_status_all dryRun returned unexpected result");
    }

    const githubSyncCheck = await callJson(client, "github_sync_check", { path: root, dryRun: true });
    if (githubSyncCheck.path !== root || !("LOCAL" in githubSyncCheck) || !("REMOTE" in githubSyncCheck) || !("DIFFERENCE" in githubSyncCheck)) {
      fail("github_sync_check returned unexpected result");
    }

    const githubCheckpointPreview = await callJson(client, "github_checkpoint_all", { dryRun: true });
    if (!githubCheckpointPreview.dryRun || !Array.isArray(githubCheckpointPreview.results)) {
      fail("github_checkpoint_all dryRun returned unexpected result");
    }

    const browserStatus = await callJson(client, "browser_status", { dryRun: true });
    if (!browserStatus.dryRun || typeof browserStatus.running !== "boolean" || typeof browserStatus.manageable !== "boolean") {
      fail("browser_status dryRun returned unexpected result");
    }

    const browserConfig = JSON.parse(await fs.readFile(path.join(root, "config", "browser.json"), "utf8"));
    if (!Array.isArray(browserConfig.allowedSites) || browserConfig.allowedSites.length < 5) {
      fail("browser.json could not be read");
    }

    const browserCheckpoint = await callJson(client, "browser_checkpoint", {});
    if (!browserCheckpoint.lastSavedAt || !Array.isArray(browserCheckpoint.tabs)) {
      fail("browser_checkpoint returned unexpected result");
    }

    const browserState = JSON.parse(await fs.readFile(path.join(root, "config", "browser-state.json"), "utf8"));
    if (!Array.isArray(browserState.tabs)) {
      fail("browser-state.json could not be read");
    }

    const syncState = await callJson(client, "sync_project_state", { path: root, dryRun: true });
    if (syncState.path !== root || !syncState.local || !syncState.remote || !syncState.difference) {
      fail("sync_project_state dryRun returned unexpected result");
    }

    const recoveryJson = JSON.parse(await fs.readFile(path.join(root, "config", "recovery.json"), "utf8"));
    if (!Array.isArray(recoveryJson.projects)) {
      fail("recovery.json could not be read");
    }

    const registerPreview = await callJson(client, "register_project", {
      name: tempProjectName,
      path: tempProject,
      dryRun: true
    });
    if (!registerPreview.dryRun || registerPreview.exchangeProjectDir !== path.join(root, "exchange", "projects", tempProjectName)) {
      fail("register_project dryRun returned unexpected result");
    }

    const registerResult = await callJson(client, "register_project", {
      name: tempProjectName,
      path: tempProject,
      dryRun: false
    });
    if (registerResult.dryRun !== false || registerResult.exchangeProjectDir !== path.join(root, "exchange", "projects", tempProjectName)) {
      fail("register_project returned unexpected result");
    }

    const systemAfterRegister = await callJson(client, "system_status", {});
    if (!systemAfterRegister.projects.some(project => project.name === tempProjectName)) {
      fail("registered project was not visible in system_status");
    }

    const unregisterResult = await callJson(client, "unregister_project", {
      name: tempProjectName,
      path: tempProject,
      dryRun: false
    });
    if (unregisterResult.dryRun !== false) {
      fail("unregister_project returned unexpected result");
    }

    const systemAfterUnregister = await callJson(client, "system_status", {});
    if (systemAfterUnregister.projects.some(project => project.name === tempProjectName)) {
      fail("unregister_project rollback did not remove project from system_status");
    }

    const backupPreview = await callJson(client, "backup_project", { path: root, dryRun: true });
    if (!backupPreview.dryRun || backupPreview.projectPath !== root) {
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
    await fs.rm(tempProject, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
