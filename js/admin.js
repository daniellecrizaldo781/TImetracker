/* =========================================================================
 * TT - Admin dashboard (Hubstaff-inspired workforce management)
 * All pages read from the same Store records (sessions, breaks, activity,
 * schedules, attendance, payroll) — no disconnected sample data.
 * ========================================================================= */

(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const body = $("pageBody"), titleEl = $("pageTitle"), headFilters = $("headFilters");

  let empIndex = {};   // id -> employee
  let projectsIndex = {};
  let settings = {};
  let state = { page: "overview", from: todayStr(), to: todayStr(), empId: "", payFrom: payPeriodStart(), payTo: payPeriodEnd() };
  const allowanceLabel = (t) => ({ first: "First Break", second: "Second Break", restroom: "Restroom", lunch: "Lunch" }[t] || t);
  const statusBadge = (s) => {
    const map = { on_time:"b-ok", late:"b-warn", absent:"b-muted", missed_shift:"b-muted", abandoned:"b-danger", early_departure:"b-warn", overtime:"b-ok", incomplete:"b-warn", pending:"b-muted", approved:"b-ok", overbreak:"b-danger", within:"b-ok", active:"b-ok", working:"b-ok", completed:"b-muted", draft:"b-muted", review:"b-warn", flagged:"b-danger" };
    return `<span class="badge ${map[s]||"b-muted"}">${UTIL.esc(String(s).replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()))}</span>`;
  };

  function todayStr() { return new Date().toISOString().slice(0,10); }
  function payPeriodStart() { const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10); }
  function payPeriodEnd() { const d=new Date(); d.setMonth(d.getMonth()+1,0); return d.toISOString().slice(0,10); }
  function esc(s) { return UTIL.esc(s); }
  function empName(id) { const e = empIndex[id]; return e ? e.full_name : (id||"—"); }
  function projName(id) { return projectsIndex[id] || id || "—"; }
  let teamIndex = {};   // team id -> name
  function teamName(id) { return teamIndex[id] || id || "—"; }
  function teamOptions() {
    const ts = (API.settings().data.teams) || [];
    return `<option value="">All teams</option>` + ts.map(t => `<option value="${esc(t.id)}" ${state.teamId===t.id?"selected":""}>${esc(t.name)}</option>`).join("");
  }

  function showView(name) {
    $("dashView").classList.toggle("hidden", name !== "dash");
  }
  async function ssoEnter(email) { await enterDash(); }

  async function enterDash() {
    if (API.isDemo()) { $("demoBanner").hidden = false; $("demoBanner").textContent = window.TT_CONFIG.DEMO_NOTE; }
    // Render immediately with whatever data is in the Store; pull live Supabase
    // data in the background so a slow/hanging sync can never block the login.
    if (typeof LIVE !== 'undefined' && LIVE.enabled()) {
      LIVE.syncIntoStore().then(() => {
        refillIndexes();
        switchPage(state.page || "overview");
      }).catch((e) => console.warn('live sync', e));
    }
    refillIndexes();
    showView("dash");
    switchPage("overview");
  }

  function refillIndexes() {
    const ref = API.refs().data;
    ref.employees.forEach(e => empIndex[e.id] = e);
    ref.projects.forEach(p => projectsIndex[p.id] = p);
    settings = Object.assign({}, API.settings().data || {});
    (settings.teams || []).forEach(t => teamIndex[t.id] = t.name);
  }

  const TITLES = {
    overview: "Overview", timesheets: "Timesheets", activity: "Activity",
    breaks: "Break Monitoring", schedule: "Schedule & Attendance",
    reports: "Reports", payroll: "Payroll Reports", employees: "Employees",
    teams: "Teams", projects: "Projects & Tasks", settings: "Settings",
  };

  function switchPage(page) {
    state.page = page;
    document.querySelectorAll(".nav-item").forEach(n => n.style.fontWeight = n.dataset.page === page ? "700" : "400");
    titleEl.textContent = TITLES[page] || page;
    headFilters.innerHTML = "";
    // A single rendering error must never kill navigation — wrap each render and
    // surface the error in the page body so we can SEE why a page fails.
    var render = null;
    if (page === "overview") render = renderOverview;
    else if (page === "timesheets") render = renderTimesheets;
    else if (page === "activity") render = renderActivity;
    else if (page === "breaks") render = renderBreaks;
    else if (page === "schedule") render = renderSchedule;
    else if (page === "reports") render = renderReports;
    else if (page === "payroll") render = renderPayroll;
    else if (page === "employees") render = renderEmployees;
    else if (page === "teams") render = renderTeams;
    else if (page === "projects") render = renderProjects;
    else if (page === "settings") render = renderSettings;
    if (render) {
      try { render(); }
      catch (e) {
        console.error("render [" + page + "] failed:", e);
        body.innerHTML = `<p class="muted" style="color:var(--danger)">This page hit an error: <b>${esc(String(e.message || e))}</b>. The rest of the dashboard still works — here's the tech detail: ${esc(String(e.stack||e))}</p>`;
      }
    }
  }

  function addHeadFilters(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    headFilters.appendChild(wrap.firstElementChild || wrap);
  }

  function kpiGrid(items) {
    return `<div class="kpi-row2">${items.map(i => `
      <div class="kpi"><span class="kpi-num">${i.num}</span><span class="kpi-lab">${esc(i.lab)}</span></div>`).join("")}</div>`;
  }

  /* ============================ OVERVIEW ============================ */
  function renderOverview() {
    const d = API.dashboard().data;
    const empList = API._raw.employees.filter(e => e.is_active);
    const liveRows = empList.map(e => {
      const s = API._raw.sessions.find(x => x.employee_id === e.id && x.status === "active");
      const openBrk = API._raw.breaks.find(b => b.employee_id === e.id && !b.ended_at);
      const st = openBrk ? "on break" : (s ? "working" : "offline");
      const sched = API._raw.schedules.find(x => x.employee_id === e.id && x.shift_date === todayStr());
      const tracked = s ? UTIL.msToClock(Date.now() - new Date(s.started_at).getTime() - (s.break_ms||0)) : "—";
      return `<tr data-emp="${esc(e.id)}" class="clickable-emp">
        <td>${esc(e.full_name)}</td>
        <td>${sched ? esc(sched.shift_start + "–" + sched.shift_end) : "—"}</td>
        <td>${s ? esc(s.started_at.slice(11,16)) : "—"}</td>
        <td>${statusBadge(st)}</td><td>${tracked}</td>
        <td>${s && s.activity_pct != null ? s.activity_pct + "%" : "—"}</td>
        <td>${s ? UTIL.msToClock(s.idle_ms||0) : "—"}</td>
        <td>${statusBadge(sched ? "pending" : "no-schedule")}</td>
      </tr>`;
    }).join("");
    body.innerHTML = `
      ${kpiGrid([
        { num: d.totalEmployees, lab: "Total Employees" },
        { num: d.live.working, lab: "Currently Working" },
        { num: d.onBreakNow, lab: "On Break" },
        { num: d.live.offline, lab: "Not Working" },
        { num: UTIL.hoursToLabel(d.trackedTodayMs), lab: "Tracked Today" },
        { num: d.activityToday + "%", lab: "Avg Activity" },
        { num: UTIL.msToClock(d.overbreakToday), lab: "Overbreak Today" },
        { num: d.pendingTimesheets, lab: "Pending Timesheets" },
      ])}
      <h2 class="sec">Live employee activity</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Schedule</th><th>Clock-in</th><th>Status</th><th>Tracked</th><th>Activity</th><th>Idle</th><th>Attendance</th></tr></thead>
        <tbody>${liveRows}</tbody>
      </table></div>`;
    bindEmpClicks();
  }

  function bindEmpClicks() {
    document.querySelectorAll(".clickable-emp").forEach(tr => tr.addEventListener("click", () => {
      const id = tr.dataset.emp || tr.dataset.eid;
      if (!id) return;
      state.empId = id;
      switchPage(state.page === "overview" ? "employees" : state.page);
    }));
  }

  /* ============================ TIMESHEETS ============================ */
  function renderTimesheets() {
    addHeadFilters(`
      <select id="fEmp">${empOptions()}</select>
      <input type="date" id="fFrom" value="${state.from}"><input type="date" id="fTo" value="${state.to}">
      <button class="btn" id="fApply">Apply</button>`);
    const rows = API._raw.sessions.slice().filter(s => s.status === "completed" &&
      (!state.from || s.started_at.slice(0,10) >= state.from) && (!state.to || s.started_at.slice(0,10) <= state.to) &&
      (!state.empId || s.employee_id === state.empId));
    let totalTracked = 0, totalValid = 0, totalIdle = 0;
    const trs = rows.sort((a,b)=>b.started_at.localeCompare(a.started_at)).map(s => {
      const ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
      const tracked = ms - (s.break_ms||0);
      const idle = s.idle_ms||0;
      const valid = Math.max(0, tracked - idle);
      totalTracked += tracked; totalValid += valid; totalIdle += idle;
      const te = API._raw.timesheet.find(t => t.session_id === s.id);
      return `<tr data-sid="${esc(s.id)}">
        <td>${esc(empName(s.employee_id))}</td><td>${esc(s.started_at.slice(0,10))}</td>
        <td>${esc(s.project||"—")}</td><td>${esc(s.task||"—")}</td>
        <td>${esc(s.started_at.slice(11,16))}</td><td>${esc((s.ended_at||"").slice(11,16))}</td>
        <td>${UTIL.msToClock(s.break_ms||0)}</td><td>${UTIL.msToClock(tracked)}</td>
        <td>${UTIL.msToClock(idle)}</td><td>${UTIL.hoursToLabel(valid)}</td>
        <td>${s.activity_pct != null ? s.activity_pct + "%" : "—"}</td>
        <td>${statusBadge(s.att === "late" ? "late" : "on_time")}</td>
        <td data-approve>${te ? statusBadge(te.status) : statusBadge("pending")}</td>
      </tr>`;
    });
    body.innerHTML = `
      ${kpiGrid([{num:UTIL.hoursToLabel(totalTracked),lab:"Tracked"},{num:UTIL.hoursToLabel(totalIdle),lab:"Idle"},{num:UTIL.hoursToLabel(totalValid),lab:"Valid Work"},{num:rows.length,lab:"Entries"}])}
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Date</th><th>Project</th><th>Task</th><th>In</th><th>Out</th><th>Break</th><th>Tracked</th><th>Idle</th><th>Valid</th><th>Activity</th><th>Attendance</th><th>Status</th></tr></thead>
        <tbody>${trs || "<tr><td colspan=13 class='muted'>No completed sessions in range.</td></tr>"}</tbody>
      </table></div>`;
    const apply = $("fApply"); if (apply) apply.addEventListener("click", () => {
      state.from = $("fFrom").value || ""; state.to = $("fTo").value || ""; state.empId = $("fEmp").value; renderTimesheets();
    });
    document.querySelectorAll("td[data-approve]").forEach(()=>{});
  }

  /* ============================ ACTIVITY ============================ */
  function renderActivity() {
    addHeadFilters(`<select id="aEmp">${empOptions()}</select><input type="date" id="aFrom" value="${state.from}"><button class="btn" id="aApply">Apply</button>`);
    const activity = API._raw.activity;
    const byEmp = {};
    activity.forEach(a => {
      if (state.empId && a.employee_id !== state.empId) return;
      if (state.from && a.bucket_at.slice(0,10) !== state.from) return;
      if (!byEmp[a.employee_id]) byEmp[a.employee_id] = { mouse:0, keys:0 };
      byEmp[a.employee_id].mouse += a.mouse_events;
      byEmp[a.employee_id].keys += a.key_events;
    });
    const rows = Object.keys(byEmp).map(id => {
      const b = byEmp[id];
      const sessions = API._raw.sessions.filter(s => s.employee_id === id && s.status === "completed");
      const activeMs = sessions.reduce((a,s)=>a+((s.activity_pct!=null)?((new Date(s.ended_at)-new Date(s.started_at))*(s.activity_pct/100)):0),0);
      const idleMs = sessions.reduce((a,s)=>a+(s.idle_ms||0),0);
      return `<tr><td>${esc(empName(id))}</td><td>${b.mouse}</td><td>${b.keys}</td>
        <td>${UTIL.hoursToLabel(activeMs)}</td><td>${UTIL.msToClock(idleMs)}</td><td>${avgActivity(id)}</td></tr>`;
    }).join("");
    body.innerHTML = `
      <p class="muted">Activity % is computed from real recorded interaction counts during eligible work time. It reflects browser/application activity only — not system-wide monitoring.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Mouse events</th><th>Key events</th><th>Active time</th><th>Idle time</th><th>Activity %</th></tr></thead>
        <tbody>${rows || "<tr><td colspan=6 class='muted'>No activity recorded in range (start a tracking session to generate data).</td></tr>"}</tbody>
      </table></div>`;
    const aApply = $("aApply"); if (aApply) aApply.addEventListener("click", () => { state.from = $("aFrom").value || ""; state.empId = $("aEmp").value; renderActivity(); });
  }
  function avgActivity(id) {
    const s = API._raw.sessions.filter(x => x.employee_id === id && x.status === "completed");
    if (!s.length) return "—";
    const withP = s.filter(x => x.activity_pct != null);
    return withP.length ? Math.round(withP.reduce((a,x)=>a+x.activity_pct,0)/withP.length)+"%" : "0%";
  }

  /* ============================ BREAKS ============================ */
  function renderBreaks() {
    addHeadFilters(`<select id="bEmp">${empOptions()}</select><select id="bType">${["","first","second","restroom","lunch"].map(t=>`<option value="${t}">${t?allowanceLabel(t):"All types"}</option>`).join("")}</select><button class="btn" id="bApply">Apply</button>`);
    const daysTotals = { within:0, overbreak:0, ongoing:0 };
    const rows = API._raw.breaks.slice().reverse().filter(b => {
      if (state.empId && b.employee_id !== state.empId) return false;
      return true;
    }).map(b => {
      const st = b.status;
      if (!b.ended_at) daysTotals.ongoing++;
      else if (st==="overbreak") daysTotals.overbreak++;
      else if (st==="within"||st==="admin_exception") daysTotals.within++;
      const expectedReturn = b.started_at ? new Date(new Date(b.started_at).getTime() + b.allowed_min*60000).toISOString() : "";
      return `<tr>
        <td>${esc(empName(b.employee_id))}</td>
        <td>${esc(new Date(b.started_at).toLocaleDateString())}</td>
        <td>${esc(allowanceLabel(b.break_type))}</td>
        <td>${esc(b.started_at.slice(11,16))}</td>
        <td>${esc((expectedReturn||"").slice(11,16))}</td>
        <td>${b.ended_at ? esc(b.ended_at.slice(11,16)) : "—"}</td>
        <td>${b.allowed_min}m</td><td>${b.ended_at ? UTIL.msToClock(b.actual_ms) : "—"}</td>
        <td>${b.overbreak_ms ? "+"+UTIL.msToClock(b.overbreak_ms) : "0"}</td>
        <td>${statusBadge(b.ended_at ? b.status : "in_progress")}</td>
      </tr>`;
    }).join("");
    body.innerHTML = `
      ${kpiGrid([{num:daysTotals.within,lab:"Within Allowance"},{num:daysTotals.ongoing,lab:"On Break Now"},{num:"+"+UTIL.msToClock(API.dashboard().data.overbreakToday),lab:"Overbreak Today"},{num:API._raw.breaks.filter(b=>b.overbreak_ms>0 && !b.admin_approved).length,lab:"Overbreak Occurrences"}])}
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Date</th><th>Type</th><th>Start</th><th>Expected Return</th><th>Returned</th><th>Allowed</th><th>Actual</th><th>Overbreak</th><th>Status</th></tr></thead>
        <tbody>${rows || "<tr><td colspan=10 class='muted'>No break records.</td></tr>"}</tbody>
      </table></div>`;
    const bApply=$("bApply"); if(bApply) bApply.addEventListener("click",()=>{ state.empId=$("bEmp").value; renderBreaks(); });
  }

  /* ============================ SCHEDULE & ATTENDANCE ============================ */
  function parseDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1]-1, +p[2]); }
  function toDateStr(d) {
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  function weekDates(anchor) {
    var a = parseDate(anchor);
    var day = (a.getDay() + 6) % 7; // 0=Mon
    a.setDate(a.getDate() - day);
    var out = [];
    for (var i = 0; i < 7; i++) { var d = new Date(a); d.setDate(a.getDate() + i); out.push(toDateStr(d)); }
    return out;
  }
  function shiftWeek(direction) {
    // move the current week by +/- 7 days without UTC date drift
    var cur = parseDate(state.schedWeek);
    cur.setDate(cur.getDate() + (direction > 0 ? 7 : -7));
    state.schedWeek = toDateStr(cur);
  }
  function renderSchedule() {
    // week navigation state
    if (!state.schedWeek) state.schedWeek = todayStr();
    var dates = weekDates(state.schedWeek);
    var dow = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    var scheds = (API.listSchedules() && API.listSchedules().data) || [];
    var att = (API.attendanceAll() && API.attendanceAll().data) || [];
    var empList = API._raw.employees.filter(e=>e.is_active);

    // shift status from attendance
    function shiftStatus(empId, date) {
      var a = att.find(x=>x.employee_id===empId && x.shift_date===date);
      return a ? a.status : "";
    }

    var rows = empList.map(e => {
      var cells = dates.map(function (d) {
        var s = scheds.find(x=>x.employee_id===e.id && x.shift_date===d);
        if (!s) return "<td class='cal-empty no-sched'></td>";
        var st = shiftStatus(e.id, d);
        var stCls = { on_time:"b-ok", late:"b-warn", missed_shift:"b-muted", abandoned:"b-danger", overtime:"b-ok" }[st] || "b-ok";
        var weekend = [0,6].indexOf(parseDate(d).getDay()) >= 0;
        var cls = weekend ? "shift-block weekend" : "shift-block";
        var schedId = s.id || "";
        return `<td class="cal"><div class="${cls}">
          <div class="shift-time">${esc(s.shift_start)}–${esc(s.shift_end)}</div>
          ${s.break_start ? `<div class="shift-brk">brk ${esc(s.break_start)}–${esc(s.break_end||"")}</div>` : ""}
          <div class="shift-actions">
            <span class="badge ${stCls}">${st?esc(st.replace(/_/g," ")):"scheduled"}</span>
            <button class="lbl sched-edit" data-id="${esc(schedId)}">edit</button>
            <button class="lbl sched-del" data-id="${esc(schedId)}">✕</button>
          </div>
        </div></td>`;
      }).join("");
      return `<tr data-eid="${esc(e.id)}" class="clickable-emp"><td class="cal-emp">${esc(e.full_name)}</td>${cells}</tr>`;
    }).join("");

    var header = dates.map(function (d, i) {
      var m = new Date(d+"T00:00:00");
      return `<th>${dow[i]}<br><span class="cal-day">${m.getDate()}</span></th>`;
    }).join("");

    // add/edit form
    var editSched = state.editingSched ? scheds.find(s=>(s.id||"")===state.editingSched) : null;
    var fEmp = editSched ? editSched.employee_id : "";
    var fDate = editSched ? editSched.shift_date : "";
    var fStart = editSched ? editSched.shift_start : "08:00";
    var fEnd = editSched ? editSched.shift_end : "17:00";
    var fBStart = editSched ? (editSched.break_start||"") : "";
    var fBEnd = editSched ? (editSched.break_end||"") : "";
    var formTitle = editSched ? "Edit schedule" : "Add schedule";

    body.innerHTML = `
      <h2 class="sec">Weekly schedule · ${dates[0]} → ${dates[6]}</h2>
      <div class="sched-toolbar">
        <button class="btn" id="wPrev">‹ Prev</button>
        <span class="sched-range muted">${dow[0]} ${dates[0]} – ${dow[6]} ${dates[6]}</span>
        <button class="btn" id="wNext">Next ›</button>
        <button class="btn" id="wToday">Today</button>
      </div>

      <div class="card sched-form">
        <h3>${formTitle}</h3>
        <div class="sched-form-grid">
          <label>Employee
            <select id="sEmp">${empList.map(e=>`<option value="${esc(e.id)}" ${e.id===fEmp?"selected":""}>${esc(e.full_name)}</option>`).join("")}</select>
          </label>
          <label>Date <input type="date" id="sDate" value="${esc(fDate)}"></label>
          <label>Start <input type="time" id="sStart" value="${esc(fStart)}"></label>
          <label>End <input type="time" id="sEnd" value="${esc(fEnd)}"></label>
          <label>Break start <input type="time" id="sBStart" value="${esc(fBStart)}"></label>
          <label>Break end <input type="time" id="sBEnd" value="${esc(fBEnd)}"></label>
        </div>
        <div class="btn-row">
          <button class="btn primary" id="sSave">${editSched?"Save changes":"Add to schedule"}</button>
          <button class="btn ghost" id="sCancel" ${editSched?"":"hidden"}>Cancel</button>
          <button class="btn" id="sClear" ${editSched?"hidden":""}>Clear form</button>
        </div>
        <p id="sMsg" class="msg" hidden></p>
      </div>

      <div class="table-wrap sched-wrap"><table class="sched-grid">
        <thead><tr><th>Employee</th>${header}</tr></thead>
        <tbody>${rows||"<tr><td colspan=8 class='muted'>No employees.</td></tr>"}</tbody>
      </table></div>

      <h2 class="sec">Attendance exceptions</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Date</th><th>Actual in</th><th>Actual out</th><th>Late (min)</th><th>Early (min)</th><th>Overtime</th><th>Status</th></tr></thead>
        <tbody>${att.map(a=>`<tr><td>${esc(empName(a.employee_id))}</td><td>${esc(a.shift_date)}</td><td>${a.actual_start?esc(a.actual_start.slice(11,16)):"—"}</td><td>${a.actual_end?esc(a.actual_end.slice(11,16)):"—"}</td><td>${a.late_minutes}</td><td>${a.early_minutes}</td><td>${UTIL.msToClock(a.overtime_ms||0)}</td><td>${statusBadge(a.status)}</td></tr>`).join("")||"<tr><td colspan=8 class='muted'>No attendance records yet — auto-computed when sessions stop.</td></tr>"}</tbody>
      </table></div>`;

    // week nav
    var prev=$("wPrev"), next=$("wNext"), todayb=$("wToday");
    if (prev) prev.addEventListener("click", function(){ shiftWeek(-1); state.editingSched=null; renderSchedule(); });
    if (next) next.addEventListener("click", function(){ shiftWeek(1); state.editingSched=null; renderSchedule(); });
    if (todayb) todayb.addEventListener("click", function(){ state.schedWeek = todayStr(); state.editingSched=null; renderSchedule(); });

    // save
    var save=$("sSave");
    if (save) save.addEventListener("click", function(){
      var emp = $("sEmp").value, date = $("sDate").value, st = $("sStart").value, en = $("sEnd").value;
      var bst = $("sBStart").value, ben = $("sBEnd").value;
      var m = $("sMsg");
      if(!emp || !date || !st || !en){ m.textContent="Employee, date, start and end are required."; m.classList.add("error"); m.hidden=false; return; }
      if(en <= st){ m.textContent="End time must be after start time."; m.classList.add("error"); m.hidden=false; return; }
      var rec = { employee_id: emp, shift_date: date, shift_start: st, shift_end: en,
        break_start: bst || null, break_end: ben || null, grace_minutes: 5, week_copy_group: "", is_template: false };
      if (state.editingSched) rec.id = state.editingSched;
      var r = API.saveSchedule(rec);
      m.textContent = r.ok ? "Saved." : (r.error||"Error");
      m.classList.toggle("ok", r.ok); m.classList.toggle("error", !r.ok); m.hidden=false;
      state.editingSched = null;
      renderSchedule();
    });
    var cancel=$("sCancel"); if(cancel) cancel.addEventListener("click", function(){ state.editingSched=null; state.schedWeek=todayStr(); renderSchedule(); });
    var clear=$("sClear"); if(clear) clear.addEventListener("click", function(){ $("sDate").value=""; $("sStart").value="08:00"; $("sEnd").value="17:00"; $("sBStart").value=""; $("sBEnd").value=""; });

    // edit / delete handlers
    document.querySelectorAll(".sched-edit").forEach(b => b.addEventListener("click", function(ev){
      ev.stopPropagation();
      state.editingSched = this.dataset.id;
      renderSchedule();
    }));
    document.querySelectorAll(".sched-del").forEach(b => b.addEventListener("click", function(ev){
      ev.stopPropagation();
      if(confirm("Remove this scheduled shift?")){ API.removeSchedule(this.dataset.id); renderSchedule(); }
    }));
  }

  /* ============================ REPORTS ============================ */
  function renderReports() {
    addHeadFilters(`<select id="rEmp">${empOptions()}</select><input type="date" id="rFrom" value="${state.payFrom}"><input type="date" id="rTo" value="${state.payTo}"><select id="rGroup"><option value="emp">By employee</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="project">By project</option></select><button class="btn" id="rApply">Apply</button>`);
    const rep = API.reports("employee", state.payFrom, state.payTo).data;
    const breaks = API._raw.breaks.filter(b => b.ended_at);
    const rows = Object.keys(rep).map(k => {
      const b = rep[k];
      const empBreaks = breaks.filter(x => empName(x.employee_id) === k);
      const over = empBreaks.filter(x=>!x.admin_approved).reduce((a,x)=>a+x.overbreak_ms,0);
      return `<tr><td>${esc(k)}</td><td>${b.sessions}</td><td>${UTIL.hoursToLabel(b.hours*3600000)}</td><td>${UTIL.hoursToLabel(b.idle*3600000)}</td><td>${UTIL.hoursToLabel(b.active*3600000)}</td><td>${empBreaks.length}</td><td>${UTIL.msToClock(over)}</td></tr>`;
    }).join("");
    body.innerHTML = `
      <h2 class="sec">Time report ${state.payFrom} → ${state.payTo}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Sessions</th><th>Tracked</th><th>Idle</th><th>Active</th><th>Breaks</th><th>Overbreak</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted">Exports: the table is copied to clipboard with the export button.</p>
      <button class="btn" id="expCsv">Export CSV</button>`;
    const rApply=$("rApply"); if(rApply) rApply.addEventListener("click",()=>{ state.payFrom=$("rFrom").value; state.payTo=$("rTo").value; state.empId=$("rEmp").value; state.reportGroup=$("rGroup").value; renderReports(); });
    const exp=$("expCsv"); if(exp) exp.addEventListener("click",()=>{
      const t = document.querySelector("#pageBody .table-wrap table, #pageBody table");
      const csv = [].slice.call(t.querySelectorAll("tr")).map(r=>[].slice.call(r.querySelectorAll("th,td")).map(c=>'"'+c.innerText.replace(/"/g,'""')+'"').join(",")).join("\n");
      const blob = new Blob([csv],{type:"text/csv"}); const a=document.createElement("a");
      a.href=URL.createObjectURL(blob); a.download="time_report.csv"; a.click();
    });
  }

  /* ============================ PAYROLL ============================ */
  function renderPayroll() {
    addHeadFilters(`<input type="date" id="pFrom" value="${state.payFrom}"><input type="date" id="pTo" value="${state.payTo}"><button class="btn" id="pApply">Apply</button>`);
    const pr = API.computePayroll({ start: state.payFrom, end: state.payTo }).data;
    const rows = pr.map(p => `<tr>
      <td>${esc(p.employee_name)}</td>
      <td>${UTIL.hoursToLabel(p.scheduled_hours*3600000)}</td>
      <td>${UTIL.hoursToLabel(p.tracked_hours*3600000)}</td>
      <td>${UTIL.hoursToLabel(p.break_hours*3600000)}</td>
      <td>${UTIL.hoursToLabel(p.idle_hours*3600000)}</td>
      <td>${UTIL.hoursToLabel(p.overbreak_hours*3600000)}</td>
      <td>${UTIL.hoursToLabel(p.deducted_hours*3600000)}</td>
      <td><b>${p.valid_rendered_hours} h</b></td>
      <td>${p.hourly_rate} ${esc(p.currency)}</td>
      <td><b>${esc(p.currency)} ${p.estimated_payable.toLocaleString()}</b></td>
      <td>${statusBadge(p.status)}</td>
    </tr>`).join("");
    body.innerHTML = `
      <p class="muted">Valid Rendered Work Hours = Tracked − break − idle (when enabled) − overbreak. This is an estimate for review, not an automatic payment.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Scheduled</th><th>Tracked</th><th>Break</th><th>Idle</th><th>Overbreak</th><th>Deducted</th><th>Valid Rendered</th><th>Rate</th><th>Estimated</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    const pApply=$("pApply"); if(pApply) pApply.addEventListener("click",()=>{ state.payFrom=$("pFrom").value; state.payTo=$("pTo").value; renderPayroll(); });
  }

  /* ============================ EMPLOYEES ============================ */
  function renderEmployees() {
    addHeadFilters(`<select id="eEmp">${empOptions()}</select><select id="eTeam">${teamOptions()}</select><button class="btn" id="eApply">Apply</button>`);
    const empList = API._raw.employees.filter(e => e.is_active && (!state.teamId || e.team === state.teamId));
    const teams = API.settings().data.teams || [];
    const rows = empList.map(e => {
      const s = API._raw.sessions.filter(x => x.employee_id === e.id && x.status === "completed");
      const tracked = s.reduce((a,x)=>a+(new Date(x.ended_at)-new Date(x.started_at)-(x.break_ms||0)),0);
      const pr = API.computePayroll({start:state.payFrom,end:state.payTo}).data.find(p=>p.employee_id===e.id);
      return `<tr data-eid="${esc(e.id)}" class="clickable-emp">
        <td>${esc(e.full_name)}</td><td>${esc(e.email)}</td>
        <td><select class="emp-team-sel" data-eid="${esc(e.id)}">${teamOptionFor(e.team)}</select></td>
        <td>${esc(e.role)}</td><td>${e.hourly_rate} ${esc(e.currency)}</td>
        <td>${UTIL.hoursToLabel(tracked)}</td><td>${avgActivity(e.id)}</td>
        <td>${pr?UTIL.hoursToLabel(pr.valid_rendered_hours*3600000):"—"}</td>
      </tr>`;
    }).join("");
    body.innerHTML = `
      <div class="card sched-form">
        <h3>Add employee</h3>
        <div class="sched-form-grid">
          <label>Full name <input type="text" id="aeName" placeholder="e.g. Juan Dela Cruz"></label>
          <label>Email <input type="email" id="aeEmail" placeholder="juan@oricle.com"></label>
          <label>Role <select id="aeRole"><option value="employee">employee</option><option value="admin">admin</option></select></label>
          <label>Team <select id="aeTeam"><option value="">No team</option>${teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></label>
          <label>Hourly rate <input type="number" id="aeRate" value="0" min="0" step="0.01"></label>
        </div>
        <div class="btn-row">
          <button class="btn primary" id="aeSave">+ Add employee</button>
          <button class="btn" id="aeClear">Clear</button>
        </div>
        <p id="aeMsg" class="msg" hidden></p>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Team</th><th>Role</th><th>Rate</th><th>Tracked</th><th>Activity</th><th>Valid Work</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${state.empId ? employeeDetail(state.empId) : "<p class='muted'>Click an employee row for full profile.</p>"}`;
    // add employee
    const aeSave = $("aeSave");
    if (aeSave) aeSave.addEventListener("click", () => {
      const name = ($("aeName").value||"").trim(), email = ($("aeEmail").value||"").trim();
      const m = $("aeMsg");
      const r = API.addEmployee({ full_name: name, email: email, role: $("aeRole").value, team: $("aeTeam").value, hourly_rate: parseFloat($("aeRate").value)||0 });
      m.textContent = r.ok ? `Added ${name}.` : (r.error||"Error");
      m.classList.toggle("ok", r.ok); m.classList.toggle("error", !r.ok); m.hidden=false;
      if (r.ok) { $("aeName").value=""; $("aeEmail").value=""; $("aeRate").value="0"; rerenderEmpIndex(); renderEmployees(); }
    });
    const aeClear=$("aeClear"); if(aeClear) aeClear.addEventListener("click", ()=>{ $("aeName").value=""; $("aeEmail").value=""; $("aeRate").value="0"; });
    // team quick-assign
    document.querySelectorAll(".emp-team-sel").forEach(sel => sel.addEventListener("change", () => {
      API.assignTeam(sel.dataset.eid, sel.value);
      rerenderEmpIndex();
    }));
    bindEmpClicks();
    wireEmpEdit();
    const eApply=$("eApply"); if(eApply) eApply.addEventListener("click",()=>{ state.empId=$("eEmp").value; state.teamId=$("eTeam").value; renderEmployees(); });
  }
  function teamOptionFor(current) {
    const ts = API.settings().data.teams || [];
    return `<option value="">No team</option>` + ts.map(t => `<option value="${esc(t.id)}" ${current===t.id?"selected":""}>${esc(t.name)}</option>`).join("");
  }
  function employeeDetail(id) {
    const e = empIndex[id]; if (!e) return "";
    const sessions = API._raw.sessions.filter(s=>s.employee_id===id).sort((a,b)=>b.started_at.localeCompare(a.started_at));
    const scheds = API._raw.schedules.filter(s=>s.employee_id===id);
    const att = API._raw.attendance.filter(a=>a.employee_id===id);
    const breaks = API._raw.breaks.filter(b=>b.employee_id===id);
    const pr = API.computePayroll({start:state.payFrom,end:state.payTo}).data.find(p=>p.employee_id===id);
    return `<div class="emp-detail card">
      <h2 class="sec">${esc(e.full_name || e.email)}</h2>
      <div class="emp-edit card-inline">
        <label>Email <input type="text" id="edEmail" value="${esc(e.email)}" readonly></label>
        <label>Full name <input type="text" id="edName" value="${esc(e.full_name||"")}"></label>
        <label>Hourly rate <input type="number" id="edRate" value="${e.hourly_rate||0}" min="0" step="0.01"></label>
        <label>Team ${(()=>{const ts=API.settings().data.teams||[];return `<select id="edTeam"><option value="">No team</option>${ts.map(t=>`<option value="${esc(t.id)}" ${e.team===t.id?"selected":""}>${esc(t.name)}</option>`).join("")}</select>`;})()}</label>
        <button class="btn primary" id="edSave">Save employee</button>
        <p id="edMsg" class="msg" hidden></p>
      </div>
      <div class="kpi-row2">${[
        {num:sessions.filter(s=>s.status==="completed").length,lab:"Sessions"},
        {num:UTIL.hoursToLabel(sessions.filter(s=>s.status==="completed").reduce((a,s)=>a+(new Date(s.ended_at||Date.now())-new Date(s.started_at)-(s.break_ms||0)),0)),lab:"Total Tracked"},
        {num:breaks.length,lab:"Breaks"},
        {num:breaks.reduce((a,b)=>a+(b.overbreak_ms||0),0)?UTIL.msToClock(breaks.reduce((a,b)=>a+(b.overbreak_ms||0),0)):"0",lab:"Total Overbreak"},
        {num:att.length,lab:"Attendance records"},
        {num:pr?UTIL.hoursToLabel(pr.valid_rendered_hours*3600000)+" / "+pr.estimated_payable+pr.currency:"—",lab:"Pay (valid)"},
      ].map(k=>`<div class="kpi"><span class="kpi-num">${k.num}</span><span class="kpi-lab">${k.lab}</span></div>`).join("")}</div>
      <h3>Recent sessions</h3>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Project</th><th>Task</th><th>In</th><th>Out</th><th>Tracked</th><th>Activity</th></tr></thead><tbody>
        ${sessions.slice(0,15).map(s=>`<tr><td>${s.started_at.slice(0,10)}</td><td>${esc(s.project)}</td><td>${esc(s.task)}</td><td>${s.started_at.slice(11,16)}</td><td>${(s.ended_at||"").slice(11,16)||"—"}</td><td>${s.status!=="completed"?"(ongoing)":UTIL.msToClock(new Date(s.ended_at)-new Date(s.started_at)-(s.break_ms||0))}</td><td>${s.activity_pct!=null?s.activity_pct+"%":"—"}</td></tr>`).join("")}
      </tbody></table></div>
      <h3>Schedule</h3>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Shift</th></tr></thead><tbody>
        ${scheds.map(s=>`<tr><td>${s.shift_date}</td><td>${esc(s.shift_start)}–${esc(s.shift_end)}</td></tr>`).join("")||"<tr><td colspan=2 class='muted'>No schedule.</td></tr>"}
      </tbody></table></div>
    </div>`;
  }
  function wireEmpEdit() {
    const save = $("edSave");
    if (!save) return;
    save.addEventListener("click", () => {
      const name = ($("edName").value || "").trim();
      if (!name) { const m=$("edMsg"); m.textContent="Name is required."; m.classList.add("error"); m.hidden=false; return; }
      const r = API.updateEmployee(state.empId, { full_name: name, hourly_rate: parseFloat($("edRate").value)||0, team: $("edTeam").value });
      const m=$("edMsg"); m.textContent = r.ok ? "Saved." : (r.error||"Error");
      m.classList.toggle("ok", r.ok); m.classList.toggle("error", !r.ok); m.hidden=false;
      if (r.ok) { rerenderEmpIndex(); renderEmployees(); }
    });
  }

  /* ============================ TEAMS ============================ */
  function renderTeams() {
    const ts = API.settings().data.teams || [];
    const rows = ts.map(t => {
      const members = API._raw.employees.filter(e => e.is_active && e.team === t.id);
      const tracked = members.reduce((acc,e) => acc + API._raw.sessions.filter(s=>s.employee_id===e.id && s.status==="completed").length, 0);
      return `<div class="project team-card" data-team="${esc(t.id)}">
        <div class="team-head">
          <h4>${esc(t.name)}</h4>
          <span class="badge b-ok">${members.length} member(s)</span>
        </div>
        <ul>${members.map(e=>`<li>${esc(e.full_name)} <span class="muted">· ${esc(e.email)}</span></li>`).join("")||"<li class='muted'>No members</li>"}</ul>
        <div class="btn-row-inline">
          <button class="btn team-assign" data-team="${esc(t.id)}">Assign members</button>
          <button class="btn ghost team-rename" data-team="${esc(t.id)}" data-name="${esc(t.name)}">Rename</button>
          <button class="btn danger team-del" data-team="${esc(t.id)}">Remove</button>
        </div>
      </div>`;
    }).join("");
    body.innerHTML = `
      <h2 class="sec">Teams</h2>
      <div class="add-team">
        <input type="text" id="newTeamName" placeholder="New team name (e.g. Admin Support, Team Danielle)" style="max-width:320px;display:inline-block">
        <button class="btn primary" id="addTeamBtn">+ Add team</button>
        <p id="teamMsg" class="msg" hidden></p>
      </div>
      <div class="proj-grid" style="margin-top:12px">${rows || "<p class='muted'>No teams yet.</p>"}</div>`;
    $("addTeamBtn").addEventListener("click", () => {
      const v = ($("newTeamName").value||"").trim();
      if (!v) return;
      const r = API.addTeam(v);
      (function show(){const m=$("teamMsg");m.textContent=r.ok?"Added.":r.error||"";m.classList.toggle("error",!r.ok);m.classList.toggle("ok",r.ok);m.hidden=false;})();
      API.settings().data.teams.forEach(t=>teamIndex[t.id]=t.name);
      renderTeams();
    });
    const $a=(id)=>document.querySelector(id);
    document.querySelectorAll(".team-assign").forEach(btn => btn.addEventListener("click", () => assignTeamUI(btn.dataset.team)));
    document.querySelectorAll(".team-rename").forEach(btn => btn.addEventListener("click", () => {
      const name = prompt("New team name:", btn.dataset.name);
      if (name && name.trim()) { API.renameTeam(btn.dataset.team, name.trim()); API.settings().data.teams.forEach(t=>teamIndex[t.id]=t.name); renderTeams(); }
    }));
    document.querySelectorAll(".team-del").forEach(btn => btn.addEventListener("click", () => {
      if (confirm("Remove this team? Members lose their team assignment.")) { API.removeTeam(btn.dataset.team); API.settings().data.teams.forEach(t=>teamIndex[t.id]=t.name); renderTeams(); }
    }));
  }
  function assignTeamUI(teamId) {
    const emps = API._raw.employees.filter(e => e.is_active);
    const select = document.createElement("select");
    select.innerHTML = `<option value="">— Employee —</option>` + emps.map(e => `<option value="${esc(e.id)}">${esc(e.full_name)}</option>`).join("");
    const btn = document.createElement("button"); btn.className="btn primary"; btn.textContent="Assign";
    const box = document.createElement("div"); box.className="card"; box.style.margin="10px 0";
    box.innerHTML = "<strong>Assign members to this team</strong>";
    box.appendChild(select); box.appendChild(btn);
    const existing = document.querySelector(".assign-box"); if (existing) existing.remove();
    box.classList.add("assign-box");
    const teamCard = document.querySelector(`[data-team="${teamId}"]`);
    if (teamCard) teamCard.after(box);
    btn.addEventListener("click", () => {
      if (!select.value) return;
      API.assignTeam(select.value, teamId);
      box.remove();
      rerenderEmpIndex();
      renderTeams();
    });
  }
  function rerenderEmpIndex() {
    empIndex = {};
    API.refs().data.employees.forEach(e => empIndex[e.id]=e);
  }

  /* ============================ PROJECTS ============================ */
  function renderProjects() {
    const projects = API._raw.projects;
    const tasks = API._raw.tasks;
    const cards = projects.map(p => {
      const pts = tasks.filter(t => t.project_id === p.id);
      return `<div class="project" data-pid="${esc(p.id)}">
        <div class="team-head">
          <h4 data-pid="${esc(p.id)}" class="proj-name">${esc(p.name)}</h4>
          <div class="btn-row-inline" style="margin:0">
            <button class="btn ghost proj-edit" data-pid="${esc(p.id)}" data-name="${esc(p.name)}">Edit</button>
            <button class="btn danger proj-del" data-pid="${esc(p.id)}">✕</button>
          </div>
        </div>
        <ul class="task-list" data-pid="${esc(p.id)}">
          ${pts.map(t=>`<li class="task-item" data-tid="${esc(t.id)}">
            <span class="task-name" data-tid="${esc(t.id)}">${esc(t.name)}</span>
            <span class="task-actions">
              <button class="lbl task-edit" data-tid="${esc(t.id)}" data-tax="${esc(t.name)}">edit</button>
              <button class="lbl task-del" data-tid="${esc(t.id)}">✕</button>
            </span>
          </li>`).join("") || "<li class='muted'>No tasks</li>"}
        </ul>
        <div class="btn-row-inline" style="margin-top:8px">
          <input type="text" class="new-task-input" data-pid="${esc(p.id)}" placeholder="New task name" style="max-width:180px;display:inline-block;margin:0">
          <button class="btn task-add" data-pid="${esc(p.id)}">+ Add task</button>
        </div>
      </div>`;
    }).join("");
    body.innerHTML = `
      <div class="card sched-form">
        <h3>Add project</h3>
        <div class="btn-row" style="margin:0">
          <input type="text" id="npName" placeholder="New project name" style="max-width:280px;display:inline-block;margin:0">
          <button class="btn primary" id="npSave">+ Add project</button>
        </div>
        <p id="npMsg" class="msg" hidden></p>
      </div>
      <div class="proj-grid" style="margin-top:12px">${cards}</div>`;

    // add project
    const npSave=$("npSave");
    if (npSave) npSave.addEventListener("click", () => {
      const v = ($("npName").value||"").trim();
      const m=$("npMsg");
      const r=v ? API.addProject(v) : {ok:false,error:"Enter a project name."};
      m.textContent = r.ok ? `Added "${v}".` : (r.error||"Error");
      m.classList.toggle("ok", r.ok); m.classList.toggle("error", !r.ok); m.hidden=false;
      if (r.ok) { $("npName").value=""; projectsIndex[r.data.id]=r.data.name; pushProjectsUp(); renderProjects(); }
    });

    // project edit/delete
    document.querySelectorAll(".proj-edit").forEach(b => b.addEventListener("click", () => {
      const name = prompt("Rename project:", b.dataset.name);
      if (name && name.trim()) { API.updateProject(b.dataset.pid, { name: name.trim() }); projectsIndex[b.dataset.pid]=name.trim(); pushProjectsUp(); renderProjects(); }
    }));
    document.querySelectorAll(".proj-del").forEach(b => b.addEventListener("click", () => {
      if (confirm("Delete this project and its tasks?")) { API.removeProject(b.dataset.pid); pushProjectsUp(); renderProjects(); }
    }));

    // add task
    document.querySelectorAll(".task-add").forEach(btn => btn.addEventListener("click", () => {
      const input = document.querySelector(`.new-task-input[data-pid="${btn.dataset.pid}"]`);
      const v = (input && input.value || "").trim();
      if (!v) return;
      API.addTask(btn.dataset.pid, v);
      pushProjectsUp();
      renderProjects();
    }));
    // task edit
    document.querySelectorAll(".task-edit").forEach(b => b.addEventListener("click", () => {
      const name = prompt("Rename task:", b.dataset.tax);
      if (name && name.trim()) { API.updateTask(b.dataset.tid, { name: name.trim() }); pushProjectsUp(); renderProjects(); }
    }));
    // task delete
    document.querySelectorAll(".task-del").forEach(b => b.addEventListener("click", () => {
      if (confirm("Delete this task?")) { API.removeTask(b.dataset.tid); pushProjectsUp(); renderProjects(); }
    }));
  }

  /* Best-effort live push of projects/tasks to Supabase (never blocks UI).
     Runs only when LIVE is wired & authed; silently skipped otherwise. */
  function pushProjectsUp() {
    if (typeof LIVE !== 'undefined' && LIVE.enabled()) {
      try { LIVE.syncProjectsUp().catch((e) => console.warn('push projects', e)); } catch (e) { console.warn('push projects', e); }
    }
  }

  /* ============================ SETTINGS ============================ */
  function renderSettings() {
    const s = API.settings().data;
    body.innerHTML = `
      <div class="card" style="max-width:560px">
        <label>Idle threshold (minutes)<input type="number" id="setIdle" value="${s.idleThresholdMin}" min="1"></label>
        <label class="checkline"><input type="checkbox" id="setDed" ${s.deductIdleTime?"checked":""}> Deduct idle time from tracked hours</label>
        <label class="checkline"><input type="checkbox" id="setOverDed" ${s.dedCfg&&s.dedCfg.overbreakAll?"checked":""}> Deduct overbreak automatically</label>
        <label>Currency <input type="text" id="setCur" value="${s.currency}"></label>
        <button class="btn primary" id="saveSet">Save settings</button>
        <p id="setMsg" class="msg" hidden></p>
      </div>`;
    $("saveSet").addEventListener("click", () => {
      const ns = {
        idleThresholdMin: parseInt($("setIdle").value,10)||5,
        deductIdleTime: $("setDed").checked,
        dedCfg: Object.assign({}, settings.dedCfg, { overbreakAll: $("setOverDed").checked }),
        currency: $("setCur").value || "PHP",
      };
      const r = API.saveSettings(ns); settings = r.data;
      const m=$("setMsg"); m.textContent="Settings saved."; m.classList.add("ok"); m.hidden=false;
    });
  }

  function empOptions(includeAll) {
    const list = API._raw.employees.filter(e => e.is_active);
    return `<option value="">All employees</option>` + list.map(e => `<option value="${esc(e.id)}" ${state.empId===e.id?"selected":""}>${esc(e.full_name)}</option>`).join("");
  }

  async function logout() {
    if (window.AUTH && AUTH.enabled()) { try { await AUTH.signOut(); } catch (e) {} }
    showView("login");
  }

  function wire() {
    document.querySelectorAll(".nav-item").forEach(n => n.addEventListener("click", () => switchPage(n.dataset.page)));
    $("logoutBtn").addEventListener("click", logout);
    var demoBtn = document.getElementById("demoAdmin");
    if (demoBtn) demoBtn.addEventListener("click", function (e) {
      e.preventDefault();
      // Enter the dashboard with seeded demo data, no Supabase setup needed.
      var authO = document.getElementById("authOverlay"); if (authO) authO.style.display = "none";
      enterDash();
    });
    if (window.AUTH && AUTH.enabled()) {
      showView("login");
      AUTH.setOnAuthorized((email) => ssoEnter(email));
    } else {
      showView("login");
    }
    // auto-refresh live overview every 20s
    setInterval(() => { if (state.page === "overview" && !$("dashView").classList.contains("hidden")) renderOverview(); }, 20000);
  }
  wire();
})();
