/* =========================================================================
 * TT - Admin dashboard logic
 * ========================================================================= */

(function () {
  const $ = (id) => document.getElementById(id);
  const el = {
    login: $("loginView"), dash: $("dashView"),
    pass: $("adminPass"), loginMsg: $("loginMsg"), loginBtn: $("loginBtn"),
    logoutBtn: $("logoutBtn"), demoBanner: $("demoBanner"),
    kpiWorking: $("kpiWorking"), kpiIdle: $("kpiIdle"), kpiBreak: $("kpiBreak"),
    kpiOffline: $("kpiOffline"), kpiHours: $("kpiHours"), kpiAvg: $("kpiAvg"),
    fEmp: $("fEmp"), fStatus: $("fStatus"), fFrom: $("fFrom"), fTo: $("fTo"), apply: $("applyFilters"),
    liveTable: $("liveTable"), sessionsTable: $("sessionsTable"),
    timesheetTable: $("timesheetTable"), reportTable: $("reportTable"),
    shotGallery: $("shotGallery"), projectList: $("projectList"),
    setShotInterval: $("setShotInterval"), setIdle: $("setIdle"), setDeductIdle: $("setDeductIdle"),
    saveSettings: $("saveSettings"), settingsMsg: $("settingsMsg"),
  };

  let employees = [];
  let projects = [];
  let tasks = [];
  let settings = {};
  let currentTab = "overview";

  function showView(name) {
    el.login.classList.toggle("hidden", name !== "login");
    el.dash.classList.toggle("hidden", name !== "dash");
  }

  function setMsg(elem, text, type) {
    if (!text) { elem.hidden = true; elem.textContent = ""; return; }
    elem.textContent = text; elem.classList.toggle("error", type === "error");
    elem.classList.toggle("ok", type === "ok"); elem.hidden = false;
  }

  async function login() {
    const pass = el.pass.value.trim();
    if (!pass) { setMsg(el.loginMsg, "Enter the admin password.", "error"); return; }
    el.loginBtn.disabled = true;
    const res = await API.adminLogin(pass);
    el.loginBtn.disabled = false;
    if (!res.ok) { setMsg(el.loginMsg, res.error, "error"); return; }
    setMsg(el.loginMsg, "");
    await enterDash();
  }

  async function enterDash() {
    if (API.isDemo()) {
      el.demoBanner.hidden = false;
      el.demoBanner.textContent = window.TT_CONFIG.DEMO_NOTE;
    }
    const [empRes, pts, sRes] = await Promise.all([
      API.getEmployees(), API.getProjectsTasks(), API.getSettings(),
    ]);
    employees = empRes.data || [];
    projects = (pts.data && pts.data.projects) || [];
    tasks = (pts.data && pts.data.tasks) || [];
    settings = sRes.data || {};
    fillEmpFilter();
    fillSettings();
    renderProjects();
    showView("dash");
    loadAll();
  }

  function fillEmpFilter() {
    el.fEmp.innerHTML = '<option value="">All employees</option>' +
      employees.map(e => `<option value="${UTIL.esc(e.email)}">${UTIL.esc(e.name || e.email)}</option>`).join("");
  }

  function fillSettings() {
    el.setShotInterval.value = settings.screenshotIntervalMin || 10;
    el.setIdle.value = settings.idleThresholdMin || 5;
    el.setDeductIdle.checked = !!settings.deductIdleTime;
  }

  async function saveSettings() {
    const s = {
      screenshotIntervalMin: parseInt(el.setShotInterval.value, 10) || 10,
      idleThresholdMin: parseInt(el.setIdle.value, 10) || 5,
      deductIdleTime: el.setDeductIdle.checked,
    };
    const res = await API.saveSettings(s);
    if (res.ok) { settings = res.data; setMsg(el.settingsMsg, "Settings saved.", "ok"); }
    else setMsg(el.settingsMsg, res.error, "error");
  }

  function filter() {
    return {
      empEmail: el.fEmp.value, status: el.fStatus.value, from: el.fFrom.value, to: el.fTo.value,
    };
  }

  async function loadAll() {
    const f = filter();
    const [d, sh, ts] = await Promise.all([
      API.dashboard(f.empEmail, f.status, f.from, f.to),
      API.screenshots(f.empEmail, f.from, f.to),
      API.timesheets(f.empEmail, f.from, f.to),
    ]);
    if (d.ok) renderDashboard(d.data);
    if (sh.ok) renderShots(sh.data);
    if (ts.ok) renderTimesheets(ts.data);
    renderReports();
  }

  /* ---------------- Overview ---------------- */
  function renderDashboard(d) {
    el.kpiWorking.textContent = d.live.active;
    el.kpiIdle.textContent = d.live.idle;
    el.kpiBreak.textContent = d.live.break_;
    el.kpiOffline.textContent = d.live.offline;
    el.kpiHours.textContent = UTIL.hoursToLabel(d.totalMs) + "";
    // avg activity (approx from completed sessions in window)
    const comp = d.sessions.filter(s => s.activityPct != null);
    el.kpiAvg.textContent = comp.length ? Math.round(comp.reduce((a, s) => a + s.activityPct, 0) / comp.length) + "%" : "—";

    // live status table
    const liveRows = employees.map(e => {
      const live = d.live;
      const s = d.sessions.find(x => x.empEmail === e.email && (x.status === "active" || x.status === "paused"));
      const st = s ? s.status : "offline";
      const stName = st === "active" ? "Working" : st === "paused" ? "On Break" : "Offline";
      const stCls = st === "active" ? "b-ok" : st === "paused" ? "b-warn" : "b-muted";
      const tracked = s ? UTIL.msToClock(Date.now() - new Date(s.start).getTime() - (s.breakMs || 0)) : "—";
      const proj = s ? (s.project || "—") : "—";
      return `<tr><td>${UTIL.esc(e.name || e.email)}</td><td><span class="badge ${stCls}">${UTIL.esc(stName)}</span></td><td>${UTIL.esc(proj)}</td><td>${UTIL.esc(s && s.activityPct != null ? s.activityPct + "%" : tracked === "—" ? "—" : "measuring")}</td><td>${tracked}</td></tr>`;
    }).join("");
    el.liveTable.innerHTML = liveRows ? `<table><thead><tr><th>Employee</th><th>Status</th><th>Project</th><th>Activity</th><th>Tracked</th></tr></thead><tbody>${liveRows}</tbody></table>` : "<p class='muted'>No employees configured.</p>";

    // recent sessions table
    const rows = d.sessions.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 50);
    const body = rows.map(s => {
      const dur = (s.end ? new Date(s.end).getTime() : Date.now()) - new Date(s.start).getTime() - (s.breakMs || 0);
      return `<tr><td>${UTIL.esc(s.empEmail || "")}</td><td>${UTIL.esc(s.project || "—")}</td><td>${UTIL.esc(s.task || "—")}</td><td>${UTIL.statusBadge(s.status)}</td><td>${UTIL.msToClock(dur)}</td><td>${UTIL.fmtDateTime(s.start)}</td><td>${UTIL.fmtDateTime(s.end)}</td></tr>`;
    }).join("");
    el.sessionsTable.innerHTML = body ? `<table><thead><tr><th>Employee</th><th>Project</th><th>Task</th><th>Status</th><th>Dur</th><th>Start</th><th>End</th></tr></thead><tbody>${body}</tbody></table>` : "<p class='muted'>No sessions in this filter.</p>";
  }

  /* ---------------- Timesheets ---------------- */
  function renderTimesheets(sessions) {
    const groups = {};
    sessions.forEach(s => {
      const key = s.empEmail || "Unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });
    const body = Object.keys(groups).map(email => {
      const g = groups[email];
      let ms = 0; let n = 0; let actSum = 0; let actN = 0;
      g.forEach(s => {
        ms += (s.end ? new Date(s.end).getTime() : Date.now()) - new Date(s.start).getTime() - (s.breakMs || 0);
        n++; if (s.activityPct != null) { actSum += s.activityPct; actN++; }
      });
      const avg = actN ? Math.round(actSum / actN) + "%" : "—";
      return `<tr><td>${UTIL.esc(email)}</td><td>${n}</td><td>${UTIL.hoursToLabel(ms)}</td><td>${avg}</td></tr>`;
    }).join("");
    el.timesheetTable.innerHTML = `<table><thead><tr><th>Employee</th><th>Sessions</th><th>Tracked</th><th>Avg activity</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  /* ---------------- Reports ---------------- */
  async function renderReports(groupBy) {
    const g = groupBy || "day";
    const f = filter();
    const res = await API.reports(g, f.from, f.to);
    if (!res.ok) return;
    const buckets = res.data;
    const rows = Object.keys(buckets).sort().map(k =>
      `<tr><td>${UTIL.esc(k)}</td><td>${UTIL.hoursToLabel(buckets[k])}</td></tr>`).join("");
    el.reportTable.innerHTML = `<table><thead><tr><th>${g.toUpperCase()}</th><th>Tracked</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /* ---------------- Screenshots ---------------- */
  function renderShots(shots) {
    if (!shots.length) { el.shotGallery.innerHTML = "<p class='muted'>No screenshots in this filter.</p>"; return; }
    el.shotGallery.innerHTML = shots.map(s => `
      <figure class="shot">
        <div class="shot-img" data-full="${UTIL.esc(s.dataUrl || s.fileId || "")}">
          ${s.dataUrl ? `<img src="${s.dataUrl}" alt="screenshot" />` : `<span class="shot-empty">image stored in backend (auth required)</span>`}
        </div>
        <figcaption>${UTIL.esc(s.empEmail || "")} · ${UTIL.esc(s.project || "—")} · ${UTIL.fmtDateTime(s.ts)}</figcaption>
      </figure>`).join("");
  }

  function renderProjects() {
    const body = projects.map(p => {
      const pTasks = tasks.filter(t => t.projectId === p.id);
      return `<div class="project"><h4>${UTIL.esc(p.name)}</h4><ul>${pTasks.map(t => `<li>${UTIL.esc(t.name)}</li>`).join("") || "<li class='muted'>No tasks</li>"}</ul></div>`;
    }).join("");
    el.projectList.innerHTML = body || "<p class='muted'>No projects configured.</p>";
  }

  /* ---------------- tabs & wiring ---------------- */
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tabbody").forEach(s => s.classList.toggle("hidden", s.id !== "tab-" + tab));
    if (tab === "reports") renderReports("day");
  }

  async function logout() {
    me = null; showView("login"); el.pass.value = "";
  }

  function init() {
    el.loginBtn.addEventListener("click", login);
    el.pass.addEventListener("keydown", e => { if (e.key === "Enter") login(); });
    el.logoutBtn.addEventListener("click", logout);
    el.apply.addEventListener("click", loadAll);
    el.saveSettings.addEventListener("click", saveSettings);
    document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
    document.querySelectorAll("[data-report]").forEach(b => b.addEventListener("click", () => renderReports(b.dataset.report)));
    setInterval(() => { if (!el.dash.classList.contains("hidden")) loadAll(); }, 15000);
    showView("login");
  }
  init();
})();
