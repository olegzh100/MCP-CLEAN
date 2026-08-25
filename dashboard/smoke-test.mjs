import http from "http";
import { spawn } from "child_process";
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
child.unref();
await new Promise(r => setTimeout(r, 1200));

for (const endpoint of ["/api/status", "/api/modules", "/api/projects", "/api/context", "/api/full"]) {
  const result = await get(`${BASE}${endpoint}`);
  if (result.status !== 200) throw new Error(`${endpoint} failed: ${result.status}`);
}

const context = JSON.parse((await get(`${BASE}/api/context`)).body);
if (context.enabled !== true) throw new Error("browser auto mode is not enabled");
if (!Array.isArray(context.tabs)) throw new Error("live browser tabs are missing");
if (!Array.isArray(context.activeModules)) throw new Error("active modules are missing");

const index = await get(BASE);
if (index.status !== 200 || !index.body.includes("Browser Auto Mode")) throw new Error("index failed");

console.log(`DASHBOARD SMOKE TEST OK | tabs=${context.tabs.length} | modules=${context.activeModules.join(",") || "none"}`);
