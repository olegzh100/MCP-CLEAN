const state = { data: null, tab: "overview", manual: new Set(), loading: false };

const tabs = [
  ["overview", "Обзор"], ["auto", "Авто"], ["manual", "Ручной"], ["projects", "Проекты"],
  ["github", "GitHub"], ["recovery", "Recovery"], ["crm", "CRM"], ["deploy", "Deploy"],
  ["browser", "Browser"], ["ads", "Реклама"], ["logs", "Логи"]
];

const el = id => document.getElementById(id);
const esc = s => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"','&quot;');
const fmt = s => s ? new Date(s).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"}) : "—";

function cssStatus(status) {
  if (status === "active" || status === "ok") return "good";
  if (status === "running") return "run";
  if (status === "warning") return "warn";
  if (status === "error") return "bad";
  return "idle";
}

async function loadData(force = false) {
  if (state.loading) return;
  state.loading = true;
  try {
    if (force) await fetch("/api/auto/refresh", { method:"POST", headers:{"content-type":"application/json"}, body:"{}" });
    state.data = await fetch("/api/full", { cache:"no-store" }).then(r => r.json());
    if (!state.manual.size) (state.data.modules || []).filter(m => m.active).forEach(m => state.manual.add(m.id));
    render();
  } catch (e) {
    el("currentTask").textContent = `Ошибка обновления панели: ${e.message}`;
  } finally { state.loading = false; }
}

function badge(status, text, title="") {
  return `<span class="chip ${status}" title="${esc(title)}">${esc(text)}</span>`;
}

function render() {
  const d = state.data || {};
  const ctx = d.autoContext || {};
  const byId = Object.fromEntries((d.modules || []).map(m => [m.id, m]));
  const stripOrder = ["browser","github","crm","deploy","elama","direct"];
  el("statusStrip").innerHTML = [badge(ctx.enabled ? "good" : "warn", ctx.enabled ? "AUTO ON" : "AUTO OFF", "Автоматический выбор модулей по вкладкам браузера")]
    .concat(stripOrder.map(id => {
      const m = byId[id];
      return badge(cssStatus(m?.status), m?.name || id, m?.currentActivity || m?.tooltip || "");
    })).join("");
  el("currentTask").textContent = ctx.summary || d.status?.task || "Панель готова";
  el("tabs").innerHTML = tabs.map(([id,label]) => `<button class="tab ${state.tab===id?"active":""}" data-tab="${id}">${label}</button>`).join("");
  el("tabs").querySelectorAll("[data-tab]").forEach(btn => btn.onclick = () => { state.tab = btn.dataset.tab; render(); });

  const content = el("content");
  if (state.tab === "overview") content.innerHTML = overviewView(d);
  else if (state.tab === "auto") content.innerHTML = autoView(d);
  else if (state.tab === "manual") content.innerHTML = manualView(d);
  else if (state.tab === "projects") content.innerHTML = tableView("Проекты", d.projects || []);
  else if (state.tab === "github") content.innerHTML = tableView("GitHub", d.github || []);
  else if (state.tab === "recovery") content.innerHTML = cardView("Recovery", d.recovery);
  else if (state.tab === "crm") content.innerHTML = moduleDetail(d, "crm", d.crm);
  else if (state.tab === "deploy") content.innerHTML = moduleDetail(d, "deploy", d.deploy);
  else if (state.tab === "browser") content.innerHTML = browserView(d);
  else if (state.tab === "ads") content.innerHTML = adsView(d);
  else if (state.tab === "logs") content.innerHTML = logsView(d.logs || {});

  bindActions();
  el("refreshBtn").onclick = () => loadData(true);
  el("openMixedBtn").onclick = () => { state.tab = "auto"; render(); };
}

function contextBanner(d) {
  const ctx = d.autoContext || {};
  const current = ctx.currentTab;
  const mods = (ctx.activeModules || []).map(id => badge("run", id)).join(" ") || badge("idle", "спецмодули не нужны");
  return `<div class="panel live-panel">
    <div class="live-head"><div><h2>Автоконтекст браузера</h2><div class="small">Следит за вкладками Edge и сам активирует безопасные read-only проверки.</div></div>${badge(ctx.enabled?"good":"warn", ctx.enabled?"ВКЛЮЧЕН":"ВЫКЛЮЧЕН")}</div>
    <div class="context-grid">
      <div><div class="label">Текущая вкладка</div><div class="strong">${esc(current?.title || "Нет активной вкладки")}</div><div class="small url">${esc(current?.url || "")}</div></div>
      <div><div class="label">Автоматически выбраны</div><div class="chips">${mods}</div></div>
      <div><div class="label">Источники</div><div>${badge(ctx.bridgeOnline?"good":"idle", `Personal ${ctx.bridgeOnline?"ON":"OFF"}`)} ${badge(ctx.cdpOnline?"good":"idle", `MCP Edge ${ctx.cdpOnline?"ON":"OFF"}`)}</div></div>
    </div>
  </div>`;
}

function overviewView(d) {
  return `${contextBanner(d)}<div class="grid section">${(d.modules || []).map(moduleCard).join("")}</div>`;
}

function moduleCard(m) {
  const runtime = state.data?.autoContext?.runtimes?.[m.id];
  const reason = state.data?.autoContext?.moduleReasons?.[m.id]?.[0];
  const status = runtime?.status === "running" ? "running" : m.status;
  return `<div class="module ${state.data?.autoContext?.activeModules?.includes(m.id)?"auto-selected":""}">
    <div class="module-title"><h3>${esc(m.name)}</h3>${badge(cssStatus(status), status)}</div>
    <div class="small">Последняя проверка: ${fmt(runtime?.finishedAt || m.lastCheckedAt)}</div>
    <div class="small">${reason ? `Авто по вкладке: ${esc(reason.title)}` : "Сейчас не требуется вкладкой"}</div>
    ${runtime?.error ? `<div class="error-text">${esc(runtime.error)}</div>` : ""}
    <div class="tooltip">${esc(m.tooltip)}<br><br>Инструменты: ${esc((m.tools||[]).join(", "))}</div>
    <div class="module-actions"><button data-run-module="${esc(m.id)}">Проверить сейчас</button></div>
  </div>`;
}

function autoView(d) {
  const ctx = d.autoContext || {};
  const rows = (ctx.recognizedTabs || []).map(t => `<tr><td>${esc(t.title)}</td><td>${esc(t.sourceLabel)}</td><td>${(t.modules||[]).map(x=>badge("run",x)).join(" ")}</td><td class="url">${esc(t.url)}</td></tr>`).join("") || `<tr><td colspan="4">Специализированных вкладок сейчас нет. Browser остаётся под наблюдением.</td></tr>`;
  const runtimeRows = Object.values(ctx.runtimes || {}).map(r => `<tr><td>${esc(r.label || r.module)}</td><td>${badge(cssStatus(r.status), r.status)}</td><td>${esc(r.reason||"")}</td><td>${fmt(r.finishedAt || r.startedAt)}</td></tr>`).join("");
  return `<div class="panel">
    <div class="live-head"><div><h2>Автоматический режим</h2><p>Ничего вводить не нужно: панель анализирует открытые вкладки каждые ${Math.round((ctx.pollMs||3000)/1000)} сек.</p></div><button id="toggleAuto">${ctx.enabled?"Отключить авто":"Включить авто"}</button></div>
    <div class="section"><h3>Открытые распознанные вкладки</h3><table class="table"><tr><th>Вкладка</th><th>Источник</th><th>Модули</th><th>URL</th></tr>${rows}</table></div>
    <div class="section"><h3>Что уже запущено автоматически</h3><table class="table"><tr><th>Модуль</th><th>Статус</th><th>Причина</th><th>Время</th></tr>${runtimeRows || `<tr><td colspan="4">Ожидание подходящей вкладки</td></tr>`}</table></div>
  </div>`;
}

function manualView(d) {
  return `<div class="panel"><h2>Ручной режим</h2><p class="small">Нужен только если хотите принудительно запустить модуль независимо от открытых вкладок.</p>
    <div class="check-grid">${(d.modules||[]).map(m => `<label><input type="checkbox" data-manual="${esc(m.id)}" ${state.manual.has(m.id)?"checked":""}> ${esc(m.name)}</label>`).join("")}</div>
    <button id="runManual">Запустить выбранные проверки</button></div>`;
}

function browserView(d) {
  const ctx = d.autoContext || {};
  const rows = (ctx.tabs || []).map(t => `<tr><td>${t.focused?badge("run","ACTIVE"):""}</td><td>${esc(t.title)}</td><td>${esc(t.sourceLabel)}</td><td class="url">${esc(t.url)}</td></tr>`).join("");
  return `${contextBanner(d)}<div class="panel section"><h2>Все видимые вкладки Edge</h2><table class="table"><tr><th></th><th>Заголовок</th><th>Источник</th><th>URL</th></tr>${rows}</table></div>`;
}

function moduleDetail(d, id, config) {
  const m = (d.modules||[]).find(x => x.id === id);
  const runtime = d.autoContext?.runtimes?.[id];
  return `<div class="panel"><h2>${esc(m?.name || id)}</h2><p>${esc(m?.tooltip || "")}</p><button data-run-module="${esc(id)}">Проверить сейчас</button><h3>Авто runtime</h3><pre>${esc(JSON.stringify(runtime || {}, null, 2))}</pre><h3>Конфигурация</h3><pre>${esc(JSON.stringify(config || {}, null, 2))}</pre></div>`;
}

function adsView(d) {
  return `<div class="module-grid">${moduleDetail(d,"elama",d.advertising?.elamaState)}${moduleDetail(d,"direct",d.advertising?.directState)}</div>`;
}

function cardView(title, data) { return `<div class="panel"><h2>${esc(title)}</h2><pre>${esc(JSON.stringify(data || {}, null, 2))}</pre></div>`; }
function tableView(title, rows) { return `<div class="panel"><h2>${esc(title)}</h2><table class="table">${(rows||[]).map(row => `<tr><td>${esc(row.name || row.site || row.module || "")}</td><td>${esc(row.path || row.remote || row.lastCommit || "")}</td><td>${esc(row.branch || row.divergence || row.status || "")}</td></tr>`).join("")}</table></div>`; }
function logsView(logs) { return `<div class="panel"><h2>Логи</h2>${Object.entries(logs||{}).map(([k,v]) => `<h3>${esc(k)}.log</h3><pre>${esc(v||"")}</pre>`).join("")}</div>`; }

function bindActions() {
  document.querySelectorAll("[data-run-module]").forEach(btn => btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "Проверяю…";
    try { await fetch("/api/module/run", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({module:btn.dataset.runModule}) }); await loadData(true); }
    finally { btn.disabled = false; }
  });
  document.querySelectorAll("[data-manual]").forEach(cb => cb.onchange = () => cb.checked ? state.manual.add(cb.dataset.manual) : state.manual.delete(cb.dataset.manual));
  const runManual = el("runManual");
  if (runManual) runManual.onclick = async () => {
    runManual.disabled = true;
    try { await fetch("/api/task/run", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({modules:[...state.manual]}) }); await loadData(true); }
    finally { runManual.disabled = false; }
  };
  const toggleAuto = el("toggleAuto");
  if (toggleAuto) toggleAuto.onclick = async () => {
    const enabled = !(state.data?.autoContext?.enabled !== false);
    await fetch("/api/auto/toggle", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({enabled}) });
    await loadData(true);
  };
}

el("refreshBtn").onclick = () => loadData(true);
loadData(true);
setInterval(() => { if (!document.hidden) loadData(false); }, 2500);
