/* =========================================================================
 * TT - Store (DEMO data layer)
 * Backs the API when BACKEND_URL is empty. Mirrors the Supabase schema
 * (backend/supabase_schema.sql) table-for-table so a later swap to the real
 * project is mechanical. Data lives ONLY in this browser and is explicitly
 * NOT real synced tracking. Never stores keystroke content — only counts.
 * ========================================================================= */

const Store = (() => {
  const K = {
    employees: "tt.employees", projects: "tt.projects", tasks: "tt.tasks",
    sessions: "tt.sessions", breaks: "tt.breaks", activity: "tt.activity",
    screenshots: "tt.screenshots", schedules: "tt.schedules",
    attendance: "tt.attendance", payroll: "tt.payroll",
    timesheet: "tt.timesheet_entries", audit: "tt.audit_log",
    settings: "tt.settings", me: "tt.me", allowed: "tt.allowed_emails",
  };
  const DB = {
    employees: [],
    projects: [
      { id: "p1", name: "Oricle Support", is_archived: false },
      { id: "p2", name: "Oricle Sales", is_archived: false },
      { id: "p3", name: "Team Admin", is_archived: false },
    ],
    tasks: [
      { id: "t1", project_id: "p1", name: "Inbound call", is_archived: false },
      { id: "t2", project_id: "p1", name: "Ticket handling", is_archived: false },
      { id: "t3", project_id: "p2", name: "Lead follow-up", is_archived: false },
      { id: "t4", project_id: "p2", name: "Outbound call", is_archived: false },
      { id: "t5", project_id: "p3", name: "Admin work", is_archived: false },
    ],
    sessions: [], breaks: [], activity: [], screenshots: [],
    schedules: [], attendance: [], payroll: [], timesheet: [], audit: [],
    allowed: [],
    settings: {
      screenshotIntervalMin: 10, idleThresholdMin: 5, deductIdleTime: false,
      lateGraceMin: 5, adminPin: "admin1234", currency: "PHP",
      teams: [
        { id: "team-admin-support", name: "Admin Support" },
        { id: "team-danielle", name: "Team Danielle" },
        { id: "team-non-oha", name: "NON-OHA" },
        { id: "team-oha", name: "OHA" },
      ],
      dedCfg: { idleAll: 0, overbreakAll: 0 }, // placeholder flags; rules in util
      breakAllowances: {
        first:    { min: 15, daily: 1, label: "First Break" },
        second:   { min: 15, daily: 1, label: "Second Break" },
        restroom: { min: 5,  daily: 3, label: "Restroom Break" },
        lunch:    { min: 60, daily: 1, label: "Lunch Break" },
      },
    },
    me: null,
  };

  function persist() { for (const k of Object.keys(K)) localStorage.setItem(K[k], JSON.stringify(DB[k])); }
  function load() {
    try { for (const k of Object.keys(K)) { const r = localStorage.getItem(K[k]); if (r != null) DB[k] = JSON.parse(r); } } catch (e) {}
  }
  load();

  const util = (id) => "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const findEmp = (idOrEmail) => {
    if (!idOrEmail) return null;
    return DB.employees.find(e => e.id === idOrEmail || (e.email || "").toLowerCase() === String(idOrEmail).toLowerCase());
  };
  const nameOf = (empId) => { const e = findEmp(empId); return e ? e.full_name : (String(empId).split("@")[0] || empId); };
  const empByEmail = (email) => DB.employees.find(e => (e.email||"").toLowerCase() === String(email||"").toLowerCase());
  const empById = (id) => DB.employees.find(e => e.id === id);
  const activeSessionFor = (empId) => DB.sessions.find(s => s.employee_id === empId && (s.status === "active" || s.status === "paused"));

  /* ---------------- AUTH ---------------- */
  function loginSupabaseUser(email) {
    let rec = empByEmail(email) || empById(email);
    if (!rec) {
      const name = email.split("@")[0].replace(/[._-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());
      rec = { id: util(), email, full_name: name, role: "employee", hourly_rate: 0, currency: DB.settings.currency, team: "", is_active: true, created_at: new Date().toISOString() };
      DB.employees.push(rec);
    }
    DB.me = { id: rec.id, email: rec.email, full_name: rec.full_name, role: rec.role };
    persist();
    return { ok: true, data: DB.me };
  }
  function adminLogin(pass) {
    if (pass !== DB.settings.adminPin) return { ok: false, error: "Incorrect admin password." };
    const adm = DB.employees.find(e => e.role === "admin") || { id:"admin", email:"admin@oricle.local", full_name:"Admin", role:"admin" };
    DB.me = { id: adm.id, email: adm.email, full_name: adm.full_name, role: "admin" };
    persist();
    return { ok: true, data: DB.me };
  }
  function me() { return { ok: true, data: DB.me }; }

  /* ---------------- META ---------------- */
  const refs = () => ({ ok: true, data: {
    projects: DB.projects.filter(p=>!p.is_archived),
    tasks: DB.tasks.filter(t=>!t.is_archived),
    employees: DB.employees.filter(e=>e.is_active),
    breakAllowances: DB.settings.breakAllowances,
  }});
  const employees = () => ({ ok: true, data: DB.employees });
  const settings = () => ({ ok: true, data: DB.settings });
  function saveSettings(s) { Object.assign(DB.settings, JSON.parse(JSON.stringify(s))); persist(); return { ok: true, data: DB.settings }; }

  /* ---------------- TEAMS & EMPLOYEE MANAGEMENT ---------------- */
  function teams() { return { ok: true, data: (DB.settings.teams || []) }; }
  function addTeam(name) {
    const teams = DB.settings.teams = DB.settings.teams || [];
    if (teams.some(t => t.name.toLowerCase() === String(name).toLowerCase())) return { ok: false, error: "Team already exists." };
    teams.push({ id: util(), name: name });
    persist(); return { ok: true, data: teams };
  }
  function removeTeam(id) {
    DB.settings.teams = (DB.settings.teams||[]).filter(t => t.id !== id);
    // clear team assignment for employees on that team
    DB.employees.forEach(e => { if (e.team === id) e.team = ""; });
    persist(); return { ok: true };
  }
  function renameTeam(id, name) {
    const t = (DB.settings.teams||[]).find(x => x.id === id);
    if (t) { t.name = name; persist(); }
    return { ok: true, data: (DB.settings.teams||[]) };
  }
  function assignTeam(empId, teamId) {
    const e = empById(empId);
    if (e) { e.team = teamId || ""; persist(); }
    return { ok: true, data: e };
  }
  function updateEmployee(empId, patch) {
    const e = empById(empId);
    if (!e) return { ok: false, error: "Employee not found." };
    Object.assign(e, patch);
    persist();
    // keep in-memory index in sync via refetch on UI side
    return { ok: true, data: e };
  }
  function addEmployee(rec) {
    if (!rec || !rec.full_name || !rec.email) return { ok: false, error: "Name and email are required." };
    if (empByEmail(rec.email)) return { ok: false, error: "An employee with that email already exists." };
    const e = {
      id: util(), email: rec.email, full_name: rec.full_name, role: rec.role || "employee",
      hourly_rate: Number(rec.hourly_rate) || 0, currency: rec.currency || DB.settings.currency,
      team: rec.team || "", is_active: rec.is_active !== false, created_at: new Date().toISOString(),
    };
    DB.employees.push(e);
    persist();
    return { ok: true, data: e };
  }

  /* ---------------- PROJECTS & TASKS ---------------- */
  function addProject(name) {
    name = (name || "").trim();
    if (!name) return { ok: false, error: "Project name is required." };
    if (DB.projects.some(p => p.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "Project already exists." };
    const p = { id: util(), name: name, is_archived: false, created_at: new Date().toISOString() };
    DB.projects.push(p); persist(); return { ok: true, data: p };
  }
  function updateProject(id, patch) {
    const p = DB.projects.find(x => x.id === id);
    if (!p) return { ok: false, error: "Project not found." };
    Object.assign(p, patch); if (patch.name) p.name = String(patch.name).trim();
    persist(); return { ok: true, data: p };
  }
  function removeProject(id) {
    DB.projects = DB.projects.filter(p => p.id !== id);
    DB.tasks = DB.tasks.filter(t => t.project_id !== id);
    persist(); return { ok: true };
  }
  function addTask(projectId, name) {
    name = (name || "").trim();
    if (!name) return { ok: false, error: "Task name is required." };
    if (!DB.projects.find(p => p.id === projectId)) return { ok: false, error: "Project not found." };
    const t = { id: util(), project_id: projectId, name: name, is_archived: false };
    DB.tasks.push(t); persist(); return { ok: true, data: t };
  }
  function updateTask(id, patch) {
    const t = DB.tasks.find(x => x.id === id);
    if (!t) return { ok: false, error: "Task not found." };
    Object.assign(t, patch); if (patch.name) t.name = String(patch.name).trim();
    persist(); return { ok: true, data: t };
  }
  function removeTask(id) {
    DB.tasks = DB.tasks.filter(t => t.id !== id);
    persist(); return { ok: true };
  }

  /* ---------------- SESSIONS ---------------- */
  function startSession(empId, project, task, meta) {
    const ex = activeSessionFor(empId);
    if (ex) return { ok: false, error: "A session is already active for this employee." };
    const s = {
      id: util(), employee_id: empId, project_id: project.id || null,
      project: project.name || project, task: task.name || task,
      task_id: task.id || null, started_at: new Date().toISOString(), ended_at: null,
      status: "active", break_ms: 0, idle_ms: 0, activity_pct: null, is_reviewed: false,
      created_at: new Date().toISOString(),
    };
    DB.sessions.push(s);
    persist();
    return { ok: true, data: s };
  }
  function pauseSession(empId) {
    const s = activeSessionFor(empId);
    if (!s) return { ok: false, error: "No active session." };
    if (s.status !== "active") return { ok: false, error: "Session is not running." };
    s.status = "paused"; persist();
    return { ok: true, data: s };
  }
  function resumeSession(empId, project, task) {
    const s = activeSessionFor(empId);
    if (!s) return { ok: false, error: "No paused session." };
    s.status = "active"; s.project = (project&&project.name)||project||s.project; s.task = (task&&task.name)||task||s.task; persist();
    return { ok: true, data: s };
  }
  function stopSession(empId, pct, breakMs, idleMs) {
    const s = activeSessionFor(empId);
    if (!s) return { ok: false, error: "No active session." };
    s.ended_at = new Date().toISOString(); s.status = "completed";
    s.activity_pct = pct != null ? pct : (s.activity_pct || 50);
    if (breakMs != null) s.break_ms = breakMs;
    if (idleMs != null) s.idle_ms = idleMs;
    // auto-create pending timesheet entry
    DB.timesheet.push({ id: util(), session_id: s.id, employee_id: empId, valid_hours: 0, status: "pending", admin_note: "", approved_by: null, approved_at: null });
    // auto-reconcile attendance for this day
    upsertAttendanceFor(empId, s);
    persist();
    return { ok: true, data: s };
  }
  const myActive = (empId) => { const s = activeSessionFor(empId); return { ok: true, data: s || null }; };

  /* ---------------- BREAKS ---------------- */
  const BREAK_ALLOW = DB.settings.breakAllowances;
  function startBreak(empId, sessionId, type) {
    const s = DB.sessions.find(x => x.id === sessionId) || activeSessionFor(empId);
    if (!s) return { ok: false, error: "No active session." };
    if (s.status !== "active") return { ok: false, error: "Start a work session before a break." };
    if (DB.breaks.some(b => b.employee_id === empId && !b.ended_at)) return { ok: false, error: "A break is already in progress." };
    const allowance = BREAK_ALLOW[type];
    if (!allowance) return { ok: false, error: "Unknown break type." };
    // daily limit check
    const today = new Date();
    const usedToday = DB.breaks.filter(b => b.employee_id === empId && b.break_type === type && new Date(b.started_at).toDateString() === today.toDateString()).length;
    if (usedToday >= allowance.daily) return { ok: false, error: `Daily ${allowance.label} limit (${allowance.daily}) already reached.` };
    const b = {
      id: util(), session_id: sessionId, employee_id: empId, break_type: type,
      started_at: new Date().toISOString(), ended_at: null, allowed_min: allowance.min,
      actual_ms: 0, overbreak_ms: 0, status: "in_progress", admin_approved: false,
      exception_min: 0, reason: "", approved_by: null, created_at: new Date().toISOString(),
    };
    DB.breaks.push(b);
    persist();
    return { ok: true, data: b };
  }
  function endBreak(empId, breakId) {
    const b = DB.breaks.find(x => x.id === breakId && x.employee_id === empId);
    if (!b) return { ok: false, error: "Break not found." };
    if (b.ended_at) return { ok: false, error: "Break already ended." };
    b.ended_at = new Date().toISOString();
    b.actual_ms = new Date(b.ended_at).getTime() - new Date(b.started_at).getTime();
    const over = Math.max(0, b.actual_ms - b.allowed_min * 60000);
    b.overbreak_ms = over;
    b.status = over > 0 ? "overbreak" : "within";
    // add to session break_ms
    const s = DB.sessions.find(x => x.id === b.session_id);
    if (s) s.break_ms = (s.break_ms||0) + b.actual_ms;
    persist();
    return { ok: true, data: b };
  }
  function openBreaks() { return DB.breaks.filter(b => !b.ended_at); }
  function breaksAll() { return DB.breaks; }

  /* ---------------- ACTIVITY ---------------- */
  function addActivity(empId, sessionId, bucket) {
    DB.activity.push({
      id: util(), session_id: sessionId, employee_id: empId,
      bucket_at: bucket.at, mouse_events: bucket.mouse||0, key_events: bucket.keys||0,
      active_ms: bucket.active||0, idle_ms: bucket.idle||0,
    });
    // cap size
    if (DB.activity.length > 50000) DB.activity = DB.activity.slice(-40000);
    persist();
    return { ok: true, data: true };
  }

  /* ---------------- SCREENSHOTS ---------------- */
  function recordScreenshot(shot) {
    DB.screenshots.push({
      id: util(), session_id: shot.session_id, employee_id: shot.empId, file_id: shot.fileId || ("data:" + shot.dataUrl),
      captured_at: shot.ts || new Date().toISOString(), activity_pct: shot.activity_pct || null,
      is_flagged: false, flag_note: "", flagged_by: null,
    });
    persist();
    return { ok: true, data: true };
  }

  /* ---------------- SCHEDULES ---------------- */
  function listSchedules() {
    return { ok: true, data: DB.schedules.slice().sort((a,b) => (a.shift_date < b.shift_date ? -1 : 1)) };
  }
  function saveSchedule(sc) {
    if (sc.id) {
      const i = DB.schedules.findIndex(x => x.id === sc.id);
      if (i >= 0) DB.schedules[i] = Object.assign({}, DB.schedules[i], sc);
    } else {
      sc.id = util();
      DB.schedules.push(sc);
    }
    persist(); return { ok: true, data: sc };
  }
  function removeSchedule(id) { DB.schedules = DB.schedules.filter(x => x.id !== id); persist(); return { ok: true }; }

  /* ---------------- ATTENDANCE ---------------- */
  function upsertAttendanceFor(empId, session) {
    if (!session) return;
    // find today's schedule
    const d = new Date(session.started_at);
    const day = d.toISOString().slice(0,10);
    const sched = DB.schedules.find(x => x.employee_id === empId && x.shift_date === day);
    if (!sched) return;
    let att = DB.attendance.find(x => x.employee_id === empId && x.shift_date === day);
    if (!att) att = { id: util(), employee_id: empId, schedule_id: sched.id, shift_date: day, actual_start: session.started_at, actual_end: session.ended_at, status: "pending", late_minutes: 0, early_minutes: 0, overtime_ms: 0, reason: "", reviewed_by: null, reviewed_at: null };
    if (session.started_at && !att.actual_start) att.actual_start = session.started_at;
    if (session.ended_at) att.actual_end = session.ended_at;
    // classify
    const ss = new Date(session.started_at).getTime();
    if (att.actual_start) ss;// keep
    const shStart = Date.parse(day + "T" + sched.shift_start);
    const shEnd = Date.parse(day + "T" + sched.shift_end);
    if (att.actual_start) att.late_minutes = Math.max(0, Math.round((new Date(att.actual_start).getTime() - shStart)/60000) - sched.grace_minutes);
    if (att.actual_end) {
      const ae = new Date(att.actual_end).getTime();
      att.early_minutes = Math.max(0, Math.round((shEnd - ae)/60000));
      att.overtime_ms = Math.max(0, ae - shEnd);
    }
    const now = Date.now();
    if (!att.actual_start && now > shEnd + sched.grace_minutes*60000) att.status = att.actual_start ? att.status : "missed_shift";
    else if (att.late_minutes > 0) att.status = "late";
    else if (att.actual_start) att.status = "on_time";
    DB.attendance = DB.attendance.filter(x => !(x.employee_id === empId && x.shift_date === day));
    DB.attendance.push(att);
    persist();
  }
  function attendanceAll(filters) {
    let list = DB.attendance.slice();
    if (filters && filters.empId) list = list.filter(a => a.employee_id === filters.empId);
    return { ok: true, data: list };
  }

  /* ---------------- PAYROLL ---------------- */
  function computePayroll(period) {
    // period: {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}
    const out = [];
    DB.employees.filter(e => e.is_active).forEach(emp => {
      const sessions = DB.sessions.filter(s => s.employee_id === emp.id && s.status === "completed" &&
        new Date(s.started_at) >= new Date(period.start + "T00:00:00") && new Date(s.started_at) <= new Date(period.end + "T23:59:59"));
      const trackedMs = sessions.reduce((a, s) => a + (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime() - (s.break_ms||0)), 0);
      const idleMs = sessions.reduce((a, s) => a + (s.idle_ms||0), 0);
      const breaks = DB.breaks.filter(b => b.employee_id === emp.id && b.ended_at && new Date(b.started_at) >= new Date(period.start+"T00:00:00") && new Date(b.started_at) <= new Date(period.end+"T23:59:59"));
      const breakMs = breaks.reduce((a,b) => a + b.actual_ms, 0);
      const overbreakMs = breaks.reduce((a,b) => a + Math.max(0, (b.admin_approved ? 0 : b.overbreak_ms)), 0);
      // scheduled
      const schedDays = DB.schedules.filter(s => s.employee_id === emp.id && s.shift_date >= period.start && s.shift_date <= period.end);
      const schedMs = schedDays.reduce((a,s) => a + (Date.parse(s.shift_date+"T"+s.shift_end) - Date.parse(s.shift_date+"T"+s.shift_start)), 0);
      // deductions: idle + overbreak (configurable)
      const deductIdle = DB.settings.deductIdleTime ? idleMs : 0;
      const deductMs = deductIdle + overbreakMs;
      const validHrs = Math.max(0, (trackedMs - deductMs) / 3600000);
      const schedHrs = schedMs / 3600000;
      const trackedHrs = trackedMs / 3600000;
      const est = Math.round(validHrs * Number(emp.hourly_rate||0) * 100) / 100;
      out.push({
        id: emp.id, employee_id: emp.id, employee_name: emp.full_name,
        period_start: period.start, period_end: period.end,
        scheduled_hours: round2(schedHrs), tracked_hours: round2(trackedHrs),
        break_hours: round2(breakMs/3600000), idle_hours: round2(idleMs/3600000),
        overbreak_hours: round2(overbreakMs/3600000), approved_overtime_hours: 0, unapproved_ext_hours: 0,
        deducted_hours: round2(deductMs/3600000), valid_rendered_hours: round2(validHrs),
        hourly_rate: Number(emp.hourly_rate||0), currency: emp.currency || DB.settings.currency,
        estimated_payable: est, status: "review",
      });
    });
    // persist a snapshot
    return { ok: true, data: out };
  }
  const round2 = (n) => Math.round(n*100)/100;

  /* ---------------- TIMESHEET ---------------- */
  function timesheets(empId, from, to) {
    let list = DB.sessions.slice();
    if (empId) list = list.filter(s => s.employee_id === empId);
    if (from) list = list.filter(s => s.started_at.slice(0,10) >= from);
    if (to) list = list.filter(s => s.started_at.slice(0,10) <= to);
    return { ok: true, data: list };
  }

  /* ---------------- REPORTS ---------------- */
  function reports(groupBy, from, to) {
    const sessions = DB.sessions.filter(s => s.status === "completed" &&
      (!from || s.started_at.slice(0,10) >= from) && (!to || s.started_at.slice(0,10) <= to));
    const buckets = {};
    sessions.forEach(s => {
      const d = new Date(s.started_at);
      let key;
      if (groupBy === "day") key = s.started_at.slice(0,10);
      else if (groupBy === "week") { const day=(d.getDay()+6)%7; const m=new Date(d); m.setDate(d.getDate()-day); key=m.toISOString().slice(0,10); }
      else if (groupBy === "month") key = s.started_at.slice(0,7);
      else if (groupBy === "employee") key = nameOf(s.employee_id);
      else if (groupBy === "project") key = s.project || "Unknown";
      else key = "all";
      const dur = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime() - (s.break_ms||0))/3600000;
      if (!buckets[key]) buckets[key] = { hours: 0, idle: 0, active: 0, sessions: 0 };
      buckets[key].hours += dur;
      buckets[key].idle += (s.idle_ms||0)/3600000;
      buckets[key].active += dur - (s.idle_ms||0)/3600000;
      buckets[key].sessions++;
    });
    return { ok: true, data: buckets };
  }

  /* ---------------- AUDIT ---------------- */
  function logAudit(rec) {
    rec.id = rec.id || util();
    rec.created_at = rec.created_at || new Date().toISOString();
    rec.user_email = DB.me ? DB.me.email : null;
    rec.user_id = DB.me ? DB.me.id : null;
    DB.audit.push(rec);
    persist(); return { ok: true, data: rec };
  }
  function audits() { return DB.audit.slice().sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)); }

  /* ---------------- DASHBOARD AGGREGATE ---------------- */
  function dashboard() {
    const now = Date.now();
    const today = new Date().toISOString().slice(0,10);
    const todaysSessions = DB.sessions.filter(s => s.started_at.slice(0,10) === today && s.status === "completed");
    const live = { working: 0, onBreak: 0, offline: 0 };
    const employeeLiveStatus = {};
    DB.employees.forEach(e => {
      const s = activeSessionFor(e.id);
      if (s && s.status === "active") {
        if (DB.breaks.some(b => b.employee_id === e.id && !b.ended_at)) { live.onBreak++; employeeLiveStatus[e.id] = "break"; }
        else { live.working++; employeeLiveStatus[e.id] = "working"; }
      } else { live.offline++; employeeLiveStatus[e.id] = "offline"; }
    });
    const trackedTodayMs = todaysSessions.reduce((a,s) => a + (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime() - (s.break_ms||0)), 0);
    // simpler today's tracked
    let todayMs = trackedTodayMs;
    // active sessions still running today
    DB.sessions.filter(s => s.status==="active" && s.started_at.slice(0,10)===today).forEach(s => { todayMs += now - new Date(s.started_at).getTime() - (s.break_ms||0); });
    const idleTodayMs = todaysSessions.reduce((a,s) => a+(s.idle_ms||0), 0);
    const pendingTimesheets = DB.timesheet.filter(t => t.status === "pending").length;
    return { ok: true, data: {
      totalEmployees: DB.employees.filter(e=>e.is_active).length,
      live, trackedTodayMs: todayMs, idleTodayMs, activityToday: pctOfActive(todaysSessions),
      pendingTimesheets, employeeLiveStatus,
      onBreakNow: live.onBreak,
      overbreakToday: DB.breaks.filter(b => b.ended_at && b.started_at.slice(0,10)===today).reduce((a,b)=>a+Math.max(0,(b.admin_approved?0:b.overbreak_ms)),0),
    }};
  }
  function pctOfActive(sessions) {
    if (!sessions.length) return 0;
    let total = 0, activeStats = 0;
    sessions.forEach(s => { if (s.activity_pct != null) { activeStats += s.activity_pct; total++; } });
    return total ? Math.round(activeStats / total) : 0;
  }

  /* ---------------- SEED ---------------- */
  function seed() {
    if (DB.employees.length) return;
    DB.employees.push(
      { id:"u1", email:"demo@oricle.local", full_name:"Demo Employee", role:"employee", hourly_rate:120, currency:"PHP", team:"team-admin-support", is_active:true, created_at:new Date().toISOString() },
      { id:"u2", email:"juan@oricle.local", full_name:"Juan Reyes", role:"employee", hourly_rate:150, currency:"PHP", team:"team-danielle", is_active:true, created_at:new Date().toISOString() },
      { id:"u3", email:"ana@oricle.local", full_name:"Ana Santos", role:"employee", hourly_rate:140, currency:"PHP", team:"team-non-oha", is_active:true, created_at:new Date().toISOString() },
    );
    // schedules this week
    const days = ["2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06","2026-11-07"];
    days.forEach((d,i) => {
      DB.schedules.push({ id:"sc"+i, employee_id:"u1", shift_date:d, shift_start:"08:00", shift_end:"17:00", break_start:"12:00", break_end:"13:00", grace_minutes:5, week_copy_group:"w1", is_template:false });
    });
    days.forEach((d,i) => { DB.schedules.push({ id:"scj"+i, employee_id:"u2", shift_date:d, shift_start:"09:00", shift_end:"18:00", grace_minutes:5, week_copy_group:"w1", is_template:false }); });
    // a few completed sessions to populate dashboard (yesterday + today)
    const mk = (empId, day, h, m, durMin, brkMin, idleMin, pct, project, task) => {
      const start = new Date(day + "T" + String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") + ":00");
      const end = new Date(start.getTime() + durMin*60000);
      DB.sessions.push({ id: util(), employee_id: empId, project_id:"p1", project, task, task_id:"t1", started_at:start.toISOString(), ended_at:end.toISOString(), status:"completed", break_ms:brkMin*60000, idle_ms:idleMin*60000, activity_pct:pct, is_reviewed:false, created_at:start.toISOString() });
    };
    mk("u1", "2026-11-06", 8, 0, 480, 60, 55, 82, "Oricle Support", "Inbound call");
    mk("u1", "2026-11-07", 8, 0, 300, 30, 20, 88, "Oricle Support", "Inbound call");
    mk("u2", "2026-11-06", 9, 0, 450, 60, 95, 71, "Oricle Sales", "Lead follow-up");
    mk("u2", "2026-11-07", 9, 0, 240, 15, 40, 76, "Oricle Sales", "Outbound call");
    mk("u3", "2026-11-06", 8, 30, 420, 60, 30, 90, "Oricle Support", "Ticket handling");
    // a couple of breaks yesterday
    const addBrk = (empId, day, h, m, type, durMin) => {
      const st = new Date(day + "T" + String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") + ":00");
      const en = new Date(st.getTime() + durMin*60000);
      const allowed = ({first:15,second:15,restroom:5,lunch:60})[type];
      const actual = durMin*60000, over = Math.max(0, actual - allowed*60000);
      DB.breaks.push({ id: util(), session_id: null, employee_id: empId, break_type:type, started_at:st.toISOString(), ended_at:en.toISOString(), allowed_min:allowed, actual_ms:actual, overbreak_ms:over, status: over>0?"overbreak":"within", admin_approved:false, exception_min:0, reason:"", approved_by:null, created_at:st.toISOString() });
    };
    addBrk("u1", "2026-11-06", 10, 0, "first", 20);   // overbreak 5
    addBrk("u1", "2026-11-06", 12, 0, "lunch", 60);   // within
    addBrk("u1", "2026-11-06", 14, 0, "restroom", 10);// overbreak 5
    addBrk("u2", "2026-11-06", 11, 0, "first", 15);   // within
    // reconcile attendance for seeded
    DB.sessions.filter(s=>s.status==="completed").forEach(s => upsertAttendanceFor(s.employee_id, s));
    persist();
  }
  seed();

  return {
    loginSupabaseUser, adminLogin, me, refs, employees, settings, saveSettings,
    startSession, pauseSession, resumeSession, stopSession, myActive,
    startBreak, endBreak, openBreaks, breaksAll,
    addActivity, recordScreenshot,
    listSchedules, saveSchedule, removeSchedule,
    attendanceAll, computePayroll, timesheets, reports,
    logAudit, audits, dashboard,
    teams, addTeam, removeTeam, renameTeam, assignTeam, updateEmployee,
    addEmployee, addProject, updateProject, removeProject, addTask, updateTask, removeTask,
    _raw: DB, findEmp, nameOf,
  };
})();
