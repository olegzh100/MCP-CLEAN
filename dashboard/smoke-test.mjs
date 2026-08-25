import http from "http";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const ROOT = "F:\\MCP-CLEAN";
const SERVER = path.join(ROOT, "dashboard", "server.mjs");
const BASE = "http://127.0.0.1:3210";

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

const child = spawn(process.execPath, [SERVER], { cwd: ROOT, stdio: "ignore", detached: true });
await new Promise(r => setTimeout(r, 1500));

const status = await get(`${BASE}/api/status`);
if (status.status !== 200) throw new Error("status failed");
const modules = await get(`${BASE}/api/modules`);
if (modules.status !== 200) throw new Error("modules failed");
const projects = await get(`${BASE}/api/projects`);
if (projects.status !== 200) throw new Error("projects failed");
const index = await get(BASE);
if (index.status !== 200 || !index.body.includes("MCP-CLEAN Control Center")) throw new Error("index failed");

console.log("DASHBOARD SMOKE TEST OK");

