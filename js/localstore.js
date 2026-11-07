/* =========================================================================
 * TT - LocalStore (DEMO MODE only)
 * Backs the API when BACKEND_URL is empty. Data lives ONLY in this browser.
 * This is explicitly NOT a real tracking store: nothing here is synced to
 * the company backend. Does not store typed keys/typing content — only
 * interaction counts (clicks/key presses / mouse moves) and kept activity.
 * Screenshots in demo mode are stored as small data URLs and only ever shown
 * back inside the same browser session.
 * ========================================================================= */

const LocalStore = (() => {
  const K = {
    employees: "tt.employees",
    projects: "tt.projects",
    tasks: "tt.tasks",
    sessions: "tt.sessions",
    screenshots: "tt.screenshots",
    settings: "tt.settings",
    me: "tt.me",
  };
  const DB = {
    employees: [],
    projects: [
      { id: "p1", name: "Oricle Support" },
      { id: "p2", name: "Oricle Sales" },
      { id: "p3", name: "Team Admin" },
    ],
    tasks: [
      { id: "t1", projectId: "p1", name: "Inbound call" },
      { id: "t2", projectId: "p1", name: "Ticket handling" },
      { id: "t3", projectId: "p2", name: "Lead follow-up" },
      { id: "t4", projectId: "p2", name: "Outbound call" },
      { id: "t5", projectId: "p3", name: "Admin work" },
    ],
    sessions: [],
    screenshots: [],
    settings: {
      screenshotIntervalMin: 10,
      idleThresholdMin: 5,
      deductIdleTime: false,
      adminPin: "admin1234",
    },
    me: null,
  };
  const ADMIN_EMAIL = "admin@oricle.local";

  function persist() {
    for (const k of Object.keys(K)) localStorage.setItem(K[k], JSON.stringify(DB[k]));
  }
  function load() {
    try {
      for (const k of Object.keys(K)) {
        const raw = localStorage.getItem(K[k]);
        if (raw != null) DB[k] = JSON.parse(raw);
      }
      if (!Array.isArray(DB.projects)) DB.projects = [];
    } catch (e) { /* corrupt -> defaults */ }
  }
  load();

  function findEmp(email) {
    return DB.employees.find(e => (e.email || "").toLowerCase() === (email || "").toLowerCase());
  }

  function activeSessionFor(empEmail) {
    return DB.sessions.find(s =>
      (s.empEmail || "").toLowerCase() === (empEmail || "").toLowerCase() &&
      (s.status === "active" || s.status === "paused"));
  }

  /* ---- auth ---- */
  function employeeLogin(email, pin) {
    const emp = findEmp(email);
    if (!emp) return Promise.resolve({ ok: false, error: "Employee not found." });
    if (emp.pin !== pin) return Promise.resolve({ ok: false, error: "Incorrect PIN." });
    DB.me = { role: "employee", empEmail: emp.email, name: emp.name };
    persist();
    return Promise.resolve({ ok: true, data: { role: "employee", empEmail: emp.email, name: emp.name } });
  }

  /* Post-Supabase-login identity: find or create an employee record for the
     authenticated email, then sign that employee in locally. */
  function loginSupabaseUser(email, ssoMeta) {
    var cur = findEmp(email);
    var record;
    if (cur) { record = cur; }
    else {
      var name = (ssoMeta && ssoMeta.name) || email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      record = { email: email, name: name, pin: "", active: true };
      DB.employees.push(record);
    }
    DB.me = { role: "employee", empEmail: record.email, name: record.name };
    persist();
    return Promise.resolve({ ok: true, data: { role: "employee", empEmail: record.email, name: record.name } });
  }
  function adminLogin(password) {
    if (password !== DB.settings.adminPin) return Promise.resolve({ ok: false, error: "Incorrect admin password." });
    DB.me = { role: "admin" };
    persist();
    return Promise.resolve({ ok: true, data: { role: "admin" } });
  }
  function me() {
    if (!DB.me) return Promise.resolve({ ok: true, data: null });
    return Promise.resolve({ ok: true, data: DB.me });
  }

  /* ---- meta ---- */
  function getProjectsTasks() {
    return Promise.resolve({ ok: true, data: { projects: DB.projects, tasks: DB.tasks } });
  }
  function getEmployees() {
    return Promise.resolve({ ok: true, data: DB.employees });
  }
  function getSettings() {
    return Promise.resolve({ ok: true, data: DB.settings });
  }
  function saveSettings(s) {
    Object.assign(DB.settings, JSON.parse(JSON.stringify(s)));
    persist();
    return Promise.resolve({ ok: true, data: DB.settings });
  }

  /* ---- sessions ---- */
  function startSession(empEmail, project, task) {
    const existing = activeSessionFor(empEmail);
    if (existing) return Promise.resolve({ ok: false, error: "A session is already active for this employee." });
    const s = {
      id: "s" + Date.now(),
      empEmail, project, task,
      start: new Date().toISOString(),
      end: null,
      status: "active",
      activityPct: null,
      breakMs: 0,
      lastActivitySync: new Date().toISOString(),
    };
    DB.sessions.push(s);
    persist();
    return Promise.resolve({ ok: true, data: s });
  }
  function pauseSession() {
    if (!DB.me) return Promise.resolve({ ok: false, error: "Not logged in." });
    const s = activeSessionFor(DB.me.empEmail);
    if (!s) return Promise.resolve({ ok: false, error: "No active session." });
    s.status = "paused"; persist();
    return Promise.resolve({ ok: true, data: s });
  }
  function resumeSession(project, task) {
    if (!DB.me) return Promise.resolve({ ok: false, error: "Not logged in." });
    const s = activeSessionFor(DB.me.empEmail);
    if (!s) return Promise.resolve({ ok: false, error: "No paused session." });
    s.status = "active"; s.project = project; s.task = task; persist();
    return Promise.resolve({ ok: true, data: s });
  }
  function stopSession(activity, breakMs) {
    if (!DB.me) return Promise.resolve({ ok: false, error: "Not logged in." });
    const s = activeSessionFor(DB.me.empEmail);
    if (!s) return Promise.resolve({ ok: false, error: "No active session." });
    s.end = new Date().toISOString();
    s.status = "completed";
    s.activityPct = activity && activity.pct != null ? activity.pct : 50;
    s.breakMs = breakMs || s.breakMs || 0;
    persist();
    return Promise.resolve({ ok: true, data: s });
  }
  function myActiveSession() {
    if (!DB.me || DB.me.role !== "employee") return Promise.resolve({ ok: true, data: null });
    const s = activeSessionFor(DB.me.empEmail);
    return Promise.resolve({ ok: true, data: s || null });
  }
  function recordScreenshot(shot) {
    const rec = {
      id: shot.id || ("shot" + Date.now()),
      sessionId: shot.sessionId, empEmail: shot.empEmail,
      project: shot.project, task: shot.task,
      ts: shot.ts, dataUrl: shot.dataUrl, intervalMin: shot.intervalMin,
    };
    DB.screenshots.push(rec);
    persist();
    return Promise.resolve({ ok: true, data: rec });
  }

  /* ---- admin ---- */
  function dashboard(empEmailFilter, statusFilter, from, to) {
    const toDate = to ? new Date(to + "T23:59:59") : null;
    const fromDate = from ? new Date(from + "T00:00:00") : null;
    const sessions = DB.sessions.filter(s => {
      if (empEmailFilter && (s.empEmail || "").toLowerCase() !== empEmailFilter.toLowerCase()) return false;
      if (statusFilter && statusFilter !== "all") {
        if (statusFilter === "active" && s.status !== "active") return false;
        if (statusFilter === "paused" && s.status !== "paused") return false;
        if (statusFilter === "completed" && s.status !== "completed") return false;
      }
      const t = new Date(s.start).getTime();
      if (fromDate && t < fromDate.getTime()) return false;
      if (toDate && t > toDate.getTime()) return false;
      return true;
    });
    const live = { active: 0, idle: 0, break_: 0, offline: 0 };
    DB.employees.forEach(e => {
      const s = activeSessionFor(e.email);
      if (!s) live.offline++;
      else if (s.status === "paused") live.break_++;
      else live.active++;
    });
    let totalMs = 0;
    sessions.forEach(s => {
      const end = s.end ? new Date(s.end).getTime() : Date.now();
      totalMs += Math.max(0, end - new Date(s.start).getTime() - (s.breakMs || 0));
    });
    return Promise.resolve({ ok: true, data: { sessions, live, totalMs } });
  }
  function timesheets(empEmail, from, to) {
    return dashboard(empEmail, "all", from, to).then(r => {
      if (!r.ok) return r;
      return { ok: true, data: r.data.sessions };
    });
  }
  function reports(groupBy, from, to) {
    return dashboard("", "all", from, to).then(r => {
      if (!r.ok) return r;
      const buckets = {};
      r.data.sessions.forEach(s => {
        const d = new Date(s.start);
        let key;
        if (groupBy === "day") key = d.toISOString().slice(0, 10);
        else if (groupBy === "week") { const day = (d.getDay() + 6) % 7; const m = new Date(d); m.setDate(d.getDate() - day); key = m.toISOString().slice(0, 10); }
        else if (groupBy === "month") key = d.toISOString().slice(0, 7);
        else if (groupBy === "employee") key = s.empEmail || "Unknown";
        else if (groupBy === "project") key = s.project || "Unknown";
        else key = "all";
        if (!buckets[key]) buckets[key] = 0;
        const end = s.end ? new Date(s.end).getTime() : Date.now();
        buckets[key] += Math.max(0, end - new Date(s.start).getTime() - (s.breakMs || 0));
      });
      return { ok: true, data: buckets };
    });
  }
  function screenshots(empEmail, from, to) {
    const toDate = to ? new Date(to + "T23:59:59") : null;
    const fromDate = from ? new Date(from + "T00:00:00") : null;
    const shots = DB.screenshots.filter(s => {
      if (empEmail && (s.empEmail || "").toLowerCase() !== empEmail.toLowerCase()) return false;
      const t = new Date(s.ts).getTime();
      if (fromDate && t < fromDate.getTime()) return false;
      if (toDate && t > toDate.getTime()) return false;
      return true;
    }).sort((a, b) => new Date(b.ts) - new Date(a.ts));
    return Promise.resolve({ ok: true, data: shots });
  }

  /* Seed an employee in demo mode if none exist (for quick testing). */
  function ensureDemoSeed() {
    if (DB.employees.length === 0) {
      DB.employees.push(
        { email: "demo@oricle.local", name: "Demo Employee", pin: "1234" },
        { email: "juan@oricle.local", name: "Juan Reyes", pin: "1234" },
      );
      persist();
    }
  }
  ensureDemoSeed();

  return {
    employeeLogin, adminLogin, me, getProjectsTasks, getEmployees, getSettings,
    saveSettings, startSession, pauseSession, resumeSession, stopSession,
    myActiveSession, recordScreenshot, dashboard, timesheets, reports, screenshots,
    loginSupabaseUser,
    _raw: DB,
  };
})();
