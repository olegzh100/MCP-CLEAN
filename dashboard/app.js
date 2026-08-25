const state = { data: null, tab: "overview", selected: new Set(), manual: new Set(["crm", "deploy", "direct"]) };

const tabs = [
  ["overview", "Обзор"],
  ["manual", "Ручной"],
  ["auto", "Авто"],
  ["projects", "Проекты"],
  ["github", "GitHub"],
  ["recovery", "Recovery"],
  ["crm", "CRM"],
  ["deploy", "Deploy"],
  ["browser", "Browser"],
  ["ads", "Реклама"],
  ["logs", "Логи"]
];

const el = id => document.getElementById(id);

async function loadData() {
  const [status, modules, projects, github, tasks, logs] = await Promise.all([
    fetch("/api/status").then(r => r.json()),
    fetch("/api/modules").then(r => r.json()),
    fetch("/api/projects").then(r => r.json()),
    fetch("/api/github").then(r => r.json()),
    fetch("/api/tasks").then(r => r.json()),
    fetch("/api/logs").then(r => r.json())
  ]);
  state.data = { status, modules: modules.modules, projects: projects.projects, github: github.repositories, tasks, logs };
  render();
}

function badge(status, text) {
  return `<span class="chip ${status}">${text}</span>`;
}

function render() {
  const d = state.data;
  el("statusStrip").innerHTML = [badge("good", `MCP-CLEAN`), badge("idle", `GitHub`), badge("idle", `Browser`), badge("idle", `CRM`), badge("idle", `Deploy`), badge("idle", `eLama`), badge("idle", `Direct`)].join("");
  el("currentTask").textContent = d?.status?.task || "";
  el("tabs").innerHTML = tabs.map(([id, label]) => `<button class="tab ${state.tab===id?'active':''}" data-tab="${id}">${label}</button>`).join("");
  el("tabs").querySelectorAll("[data-tab]").forEach(btn => btn.onclick = () => { state.tab = btn.dataset.tab; render(); });
  const content = el("content");
  if (state.tab === "overview") content.innerHTML = overviewView(d);
  else if (state.tab === "manual") content.innerHTML = manualView(d);
  else if (state.tab === "auto") content.innerHTML = autoView(d);
  else if (state.tab === "projects") content.innerHTML = tableView("Проекты", d.projects);
  else if (state.tab === "github") content.innerHTML = tableView("GitHub", d.github);
  else if (state.tab === "recovery") content.innerHTML = cardView("Recovery", d.recovery);
  else if (state.tab === "crm") content.innerHTML = cardView("CRM", d.crm);
  else if (state.tab === "deploy") content.innerHTML = cardView("Deploy", d.deploy);
  else if (state.tab === "browser") content.innerHTML = cardView("Browser", d.browser);
  else if (state.tab === "ads") content.innerHTML = `<div class="module-grid">${cardView("eLama", d.advertising?.elamaState)}${cardView("Direct", d.advertising?.directState)}</div>`;
  else if (state.tab === "logs") content.innerHTML = logsView(d.logs);
  el("refreshBtn").onclick = loadData;
  el("openMixedBtn").onclick = () => { state.tab = "auto"; render(); };
}

function overviewView(d) {
  return `<div class="grid">${(d.modules || []).map(moduleCard).join("")}</div>`;
}

function moduleCard(m) {
  return `<div class="module"><h3>${m.name}</h3><div class="status ${m.status}">${m.status}</div><div class="small">Последняя проверка: ${m.lastCheckedAt || "—"}</div><div class="small">Активность: ${m.currentActivity || "—"}</div><div class="tooltip">${m.tooltip}<br/><br/>Инструменты: ${(m.tools||[]).join(", ")}</div><div class="details"><button>Запустить</button></div></div>`;
}

function manualView(d) {
  const list = ["crm", "deploy", "direct", "github", "browser"];
  return `<div class="panel"><h2>Ручной режим</h2>${list.map(id => `<label><input type="checkbox" ${state.manual.has(id) ? "checked" : ""} data-manual="${id}"> ${id}</label><br/>`).join("")}<button id="runManual">Запустить выбранные</button></div>`; 
}

function autoView() {
  return `<div class="panel"><h2>Авто</h2><textarea placeholder="Опишите задачу"></textarea><button>Построить план</button></div>`;
}

function cardView(title, data) {
  return `<div class="panel"><h2>${title}</h2><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></div>`;
}

function tableView(title, rows) {
  return `<div class="panel"><h2>${title}</h2><table class="table">${(rows||[]).map(row => `<tr><td>${escapeHtml(row.name || row.site || row.module || "")}</td><td>${escapeHtml(row.path || row.remote || row.lastCommit || "")}</td><td>${escapeHtml(row.branch || row.divergence || row.status || "")}</td></tr>`).join("")}</table></div>`;
}

function logsView(logs) {
  return `<div class="panel"><h2>Логи</h2>${Object.entries(logs || {}).map(([k,v]) => `<h3>${k}.log</h3><pre>${escapeHtml(v || "")}</pre>`).join("")}</div>`;
}

function escapeHtml(s) { return String(s || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

el("refreshBtn").onclick = loadData;
loadData();

