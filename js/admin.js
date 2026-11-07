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
    const ref = API.refs().data;
    ref.employees.forEach(e => empIndex[e.id] = e);
    ref.projects.forEach(p => projectsIndex[p.id] = p);
    // empty empId -> all
    settings = Object.assign({}, API.settings().data || {});
    (settings.teams || []).forEach(t => teamIndex[t.id] = t.name);
    showView("dash");
    switchPage("overview");
  }

  const TITLES = {
    overview: "Overview", timesheets: "Timesheets", activity: "Activity",
    breaks: "Break Monitoring", screenshots: "Screenshots", schedule: "Schedule & Attendance",
    reports: "Reports", payroll: "Payroll Reports", employees: "Employees",
    teams: "Teams", projects: "Projects & Tasks", settings: "Settings",
  };

  function switchPage(page) {
    state.page = page;
    document.querySelectorAll(".nav-item").forEach(n => n.style.fontWeight = n.dataset.page === page ? "700" : "400");
    titleEl.textContent = TITLES[page] || page;
    headFilters.innerHTML = "";
    if (page === "overview") renderOverview();
    else if (page === "timesheets") renderTimesheets();
    else if (page === "activity") renderActivity();
    else if (page === "breaks") renderBreaks();
    else if (page === "screenshots") renderScreenshots();
    else if (page === "schedule") renderSchedule();
    else if (page === "reports") renderReports();
    else if (page === "payroll") renderPayroll();
    else if (page === "employees") renderEmployees();
    else if (page === "teams") renderTeams();
    else if (page === "projects") renderProjects();
    else if (page === "settings") renderSettings();
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
      if (!byEmp[a.employee_id]) byEmp[a.employee_id] = { mouse:0, keys:0, shots:0 };
      byEmp[a.employee_id].mouse += a.mouse_events;
      byEmp[a.employee_id].keys += a.key_events;
    });
    // shot counts
    API._raw.screenshots.forEach(sc => { if (byEmp[sc.employee_id] && (!state.from || sc.captured_at.slice(0,10) === state.from)) byEmp[sc.employee_id].shots++; });
    const rows = Object.keys(byEmp).map(id => {
      const b = byEmp[id];
      const sessions = API._raw.sessions.filter(s => s.employee_id === id && s.status === "completed");
      const activeMs = sessions.reduce((a,s)=>a+((s.activity_pct!=null)?((new Date(s.ended_at)-new Date(s.started_at))*(s.activity_pct/100)):0),0);
      const idleMs = sessions.reduce((a,s)=>a+(s.idle_ms||0),0);
      return `<tr><td>${esc(empName(id))}</td><td>${b.mouse}</td><td>${b.keys}</td>
        <td>${UTIL.hoursToLabel(activeMs)}</td><td>${UTIL.msToClock(idleMs)}</td><td>${avgActivity(id)}</td><td>${b.shots}</td></tr>`;
    }).join("");
    body.innerHTML = `
      <p class="muted">Activity % is computed from real recorded interaction counts during eligible work time. It reflects browser/application activity only — not system-wide monitoring.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Mouse events</th><th>Key events</th><th>Active time</th><th>Idle time</th><th>Activity %</th><th>Screenshots</th></tr></thead>
        <tbody>${rows || "<tr><td colspan=7 class='muted'>No activity recorded in range (start a tracking session to generate data).</td></tr>"}</tbody>
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

  /* ============================ SCREENSHOTS ============================ */
  function renderScreenshots() {
    addHeadFilters(`<select id="sEmp">${empOptions()}</select><button class="btn" id="sApply">Apply</button>`);
    const shots = API._raw.screenshots.slice().reverse().filter(s => !state.empId || s.employee_id === state.empId);
    const g = shots.length ? shots.map(s => `
      <figure class="shot"><div class="shot-img">
        ${s.file_id && String(s.file_id).startsWith("data:") ? `<img src="${esc(s.file_id)}" alt="screenshot" />` : `<span class="shot-empty">Stored in backend (auth required)</span>`}
      </div><figcaption>${esc(empName(s.employee_id))} · ${esc(s.captured_at.slice(0,16))} · ${s.activity_pct!=null?s.activity_pct+"%":"—"} · <a class="lbl" data-shot="${esc(s.id)}">${s.is_flagged?"⚠":"Flag"}</a></figcaption></figure>
    `).join("") : `<p class="muted">No screenshots captured yet. Screenshots are only saved from an active, authorized tracking session after the employee grants screen-share permission.</p>`;
    body.innerHTML = `
      <p class="muted">Only screenshots actually captured and saved appear here; none are generated or faked.</p>
      <div class="gallery">${g}</div>`;
    document.querySelectorAll("[data-shot]").forEach(a => a.addEventListener("click", (e) => {
      e.preventDefault(); const id = e.target.dataset.shot;
      const sh = API._raw.screenshots.find(x => x.id === id);
      if (!sh) return;
      sh.is_flagged = !sh.is_flagged; sh.flag_note = sh.is_flagged ? "Flagged for review" : ""; API.logAudit({ action:"toggle_flag", entity:"screenshot", entity_id:id, note:sh.flag_note });
      renderScreenshots();
    }));
    const sApply=$("sApply"); if(sApply) sApply.addEventListener("click",()=>{ state.empId=$("sEmp").value; renderScreenshots(); });
  }

  /* ============================ SCHEDULE & ATTENDANCE ============================ */
  function renderSchedule() {
    addHeadFilters(`<input type="month" id="schMo" value="${todayStr().slice(0,7)}"><button class="btn" id="schApply">Apply</button>`);
    const month = todayStr().slice(0,7);
    const scheds = (API.listSchedules() && API.listSchedules().data) || [];
    const att = (API.attendanceAll() && API.attendanceAll().data) || [];
    // Team view: rows=employees, cols=days
    const empList = API._raw.employees.filter(e=>e.is_active);
    const rows = empList.map(e => {
      const days = new Date(todayStr().slice(0,4), todayStr().slice(5,7)*1, 0).getDate();
      const cells = Array.from({length:days},(_,i)=> {
        const d = todayStr().slice(0,8) + String(i+1).padStart(2,"0");
        const sched = scheds.find(s=>s.employee_id===e.id && s.shift_date===d);
        if (!sched) return "<td class='cal-empty'></td>";
        const a = att.find(x=>x.employee_id===e.id && x.shift_date===d);
        return `<td class="cal on-${a?a.status:"pending"}" title="${sched.shift_start}–${sched.shift_end}">${sched.shift_start.slice(0,5)}<br>${a?statusBadge(a.status):"—"}</td>`;
      }).join("");
      return `<tr><td class="cal-emp">${esc(e.full_name)}</td>${cells}</tr>`;
    }).join("");
    body.innerHTML = `
      <h2 class="sec">Team schedule · ${todayStr().slice(0,7)}</h2>
      <div class="table-wrap sched-wrap"><table>
        <thead><tr><th>Employee</th>${Array.from({length:new Date(todayStr().slice(0,4),todayStr().slice(5,7)*1,0).getDate()},(_,i)=>`<th>${i+1}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody></table></div>
      <h2 class="sec">Attendance exceptions</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Date</th><th>Actual in</th><th>Actual out</th><th>Late (min)</th><th>Early (min)</th><th>Overtime</th><th>Status</th></tr></thead>
        <tbody>${att.map(a=>`<tr><td>${esc(empName(a.employee_id))}</td><td>${esc(a.shift_date)}</td><td>${a.actual_start?esc(a.actual_start.slice(11,16)):"—"}</td><td>${a.actual_end?esc(a.actual_end.slice(11,16)):"—"}</td><td>${a.late_minutes}</td><td>${a.early_minutes}</td><td>${UTIL.msToClock(a.overtime_ms||0)}</td><td>${statusBadge(a.status)}</td></tr>`).join("")||"<tr><td colspan=8 class='muted'>No attendance records yet — auto-computed when sessions stop.</td></tr>"}</tbody>
      </table></div>`;
    const schApply=$("schApply"); if(schApply) schApply.addEventListener("click",()=>{ /* month filter */ renderSchedule(); });
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
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Team</th><th>Role</th><th>Rate</th><th>Tracked</th><th>Activity</th><th>Valid Work</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${state.empId ? employeeDetail(state.empId) : "<p class='muted'>Click an employee row for full profile.</p>"}`;
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
    const shots = API._raw.screenshots.filter(s=>s.employee_id===id).length;
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
        {num:shots,lab:"Screenshots"},
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
    const rows = projects.map(p => {
      const ts = tasks.filter(t => t.project_id === p.id);
      return `<div class="project"><h4>${esc(p.name)}</h4><ul>${ts.map(t=>`<li>${esc(t.name)}</li>`).join("")||"<li class='muted'>No tasks</li>"}</ul></div>`;
    }).join("");
    body.innerHTML = `<div class="proj-grid">${rows}</div>`;
  }

  /* ============================ SETTINGS ============================ */
  function renderSettings() {
    const s = API.settings().data;
    body.innerHTML = `
      <div class="card" style="max-width:560px">
        <label>Screenshot interval (minutes)<input type="number" id="setShot" value="${s.screenshotIntervalMin}" min="1"></label>
        <label>Idle threshold (minutes)<input type="number" id="setIdle" value="${s.idleThresholdMin}" min="1"></label>
        <label class="checkline"><input type="checkbox" id="setDed" ${s.deductIdleTime?"checked":""}> Deduct idle time from tracked hours</label>
        <label class="checkline"><input type="checkbox" id="setOverDed" ${s.dedCfg&&s.dedCfg.overbreakAll?"checked":""}> Deduct overbreak automatically</label>
        <label>Currency <input type="text" id="setCur" value="${s.currency}"></label>
        <button class="btn primary" id="saveSet">Save settings</button>
        <p id="setMsg" class="msg" hidden></p>
      </div>`;
    $("saveSet").addEventListener("click", () => {
      const ns = {
        screenshotIntervalMin: parseInt($("setShot").value,10)||10,
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
