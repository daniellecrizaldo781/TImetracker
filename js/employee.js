/* =========================================================================
 * TT - Employee page logic (+ break management)
 * ========================================================================= */

(function () {
  const $ = (id) => document.getElementById(id);
  const CFG = window.TT_CONFIG;

  let me = null;            // {id, email, full_name, role}
  let projects = [];
  let tasks = [];
  let allowances = {};
  let settings = { idleThresholdMin: 5, deductIdleTime: false };
  let currentSession = null;   // active/paused session
  let currentBreak = null;     // in-progress break (Store ref)
  let breakTimer = null;
  let elapsedTimer = null;
  let todayMs = 0;

  const view = { login: $("loginView"), tracker: $("trackerView") };
  const el = {
    email: $("loginEmail"), pin: $("loginPin"), loginMsg: $("loginMsg"), loginBtn: $("loginBtn"),
    brandName: $("brandName"), trackerBrand: $("trackerBrand"), userEmail: $("userEmail"),
    statusPill: $("statusPill"),
    elapsed: $("elapsedDisplay"), liveActivity: $("liveActivity"), todayTotal: $("todayTotal"), idleStatus: $("idleStatus"),
    project: $("projectSelect"), task: $("taskSelect"),
    start: $("startBtn"), pause: $("pauseBtn"), resume: $("resumeBtn"), stop: $("stopBtn"),
    trackerMsg: $("trackerMsg"), demoBanner: $("demoBanner"),
    logoutBtn: $("logoutBtn"),
    breakCard: $("breakCard"), breakPicker: $("breakPicker"),
    breakStatus: $("breakStatus"), breakCountdown: $("breakCountdown"), breakRemaining: $("breakRemaining"),
  };

  function showView(name) {
    view.login.classList.toggle("hidden", name !== "login");
    view.tracker.classList.toggle("hidden", name !== "tracker");
  }
  function setMsg(elem, text, type) {
    if (!text) { elem.hidden = true; elem.textContent = ""; return; }
    elem.textContent = text;
    elem.classList.toggle("error", type === "error");
    elem.classList.toggle("ok", type === "ok");
    elem.hidden = false;
  }
  function bindDemoBanner() {
    if (API.isDemo()) { el.demoBanner.hidden = false; el.demoBanner.textContent = CFG.DEMO_NOTE; }
  }

  /* ---------------- Login ---------------- */
  async function ssoEnter(email) {
    const res = API.supabaseLogin(email);
    if (!res.ok) return;
    me = res.data;
    if (el.userEmail) el.userEmail.textContent = email;
    await enterTracker();
  }

  async function enterTracker() {
    bindDemoBanner();
    if (typeof LIVE !== 'undefined' && LIVE.enabled()) {
      try { await LIVE.syncIntoStore(); } catch (e) { console.warn('live sync', e); }
    }
    const ref = API.refs();
    projects = ref.data.projects || [];
    tasks = ref.data.tasks || [];
    allowances = (ref.data.breakAllowances) || {};
    settings = Object.assign(settings, API.settings().data || {});
    fillSelect();
    const mine = API.myActive(me.id);
    currentSession = (mine.data && (mine.data.status === "active" || mine.data.status === "paused")) ? mine.data : null;
    const open = API.openBreaks().find(b => b.employee_id === me.id);
    if (open) currentBreak = open;
    refreshUI();
    showView("tracker");
    await refreshToday();
    if (currentSession) bindRunningState();
    el.statusPill.textContent = currentSession ? (currentBreak ? "On Break" : "Working") : "Offline";
    renderBreakUI();
  }

  function fillSelect() {
    el.project.innerHTML = '<option value="">Select project…</option>' +
      projects.map(p => `<option value="${UTIL.esc(p.id)}">${UTIL.esc(p.name)}</option>`).join("");
    refreshTaskSelect();
  }
  function refreshTaskSelect() {
    const pid = el.project.value;
    const list = tasks.filter(t => !pid || t.project_id === pid);
    el.task.innerHTML = '<option value="">Select task…</option>' +
      list.map(t => `<option value="${UTIL.esc(t.id)}">${UTIL.esc(t.name)}</option>`).join("");
  }
  function chosen() {
    const p = projects.find(x => x.id === el.project.value);
    const t = tasks.find(x => x.id === el.task.value);
    return {
      project: p ? { id: p.id, name: p.name } : { id: null, name: "" },
      task: t ? { id: t.id, name: t.name } : { id: null, name: "" },
    };
  }

  /* ---------------- Today total ---------------- */
  async function refreshToday() {
    const d = new Date(), from = d.toISOString().slice(0,10), to = from;
    const r = API.timesheets(me.id, from, to);
    if (r.ok) {
      todayMs = r.data.reduce((sum, s) => {
        const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
        return sum + Math.max(0, end - new Date(s.started_at).getTime() - (s.break_ms || 0));
      }, 0);
      if (currentSession) todayMs += currentSessionElapsed();
      el.todayTotal.innerHTML = `Today: <b>${UTIL.hoursToLabel(todayMs)}</b>`;
    }
  }
  function currentSessionElapsed() {
    if (!currentSession || currentSession.status !== "active") return 0;
    return Date.now() - new Date(currentSession.started_at).getTime() - (currentSession.break_ms || 0);
  }

  /* ---------------- Session lifecycle ---------------- */
  async function startSession() {
    const c = chosen();
    if (!c.project.name || !c.task.name) { setMsg(el.trackerMsg, "Select a project and task first.", "error"); return; }
    const res = API.startSession(me.id, c.project, c.task);
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    currentSession = res.data;
    setMsg(el.trackerMsg, "", "");
    Activity.configure({ idleThresholdMs: settings.idleThresholdMin * 60000 });
    Activity.resetSession();
    Activity.start();
    bindRunningState();
    refreshUI(); renderBreakUI(); refreshToday();
    bindActivitySync();
  }
  async function resumeSession() {
    const c = chosen();
    if (!c.project.name || !c.task.name) { setMsg(el.trackerMsg, "Select a project and task.", "error"); return; }
    const res = API.resumeSession(me.id, c.project, c.task);
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    currentSession = res.data;
    bindRunningState(); refreshUI(); refreshToday(); renderBreakUI();
  }
  async function stopSession() {
    const res = API.stopSession(me.id, liveActivityPct(), currentSession ? currentSession.break_ms : 0, totalIdleMs());
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (breakTimer) clearInterval(breakTimer);
    currentSession = null; currentBreak = null;
    Activity.resetSession();
    bindRunningState(); refreshUI(); renderBreakUI(); refreshToday();
    setMsg(el.trackerMsg, "", "");
    el.statusPill.textContent = "Offline";
  }
  function totalIdleMs() { const s = Activity.idleState(); return s.idleList ? s.idleList.reduce((a,i)=>a+(i.end-i.start),0) : 0; }
  function liveActivityPct() { return 50; }

  /* ----------------- Break management ----------------- */
  function renderBreakUI() {
    const running = currentSession && currentSession.status === "active";
    el.breakCard.hidden = !running;
    if (!currentBreak) {
      el.breakPicker.style.display = "";
      el.breakStatus.hidden = true;
      el.breakCountdown.hidden = true;
      renderBreakRemaining();
      return;
    }
    el.breakPicker.style.display = "none";
    el.breakStatus.hidden = false;
    el.breakStatus.innerHTML = `On <b>${allowanceLabel(currentBreak.break_type)}</b> since ${UTIL.fmtDateTime(currentBreak.started_at)} (click timer to end)`;
    el.breakCountdown.hidden = false;
    updateBreakCountdown();
    if (!breakTimer) breakTimer = setInterval(() => { if (currentSession && currentSession.status === "active") updateBreakCountdown(); }, 1000);
  }
  function allowanceLabel(t) { const a = allowances[t]; return a ? `${a.label} (${a.min} min)` : t; }
  function renderBreakRemaining() {
    if (!me) return;
    const today = new Date().toDateString();
    const parts = Object.keys(allowances).map(t => {
      const a = allowances[t];
      const used = API._raw.breaks.filter(b => b.employee_id === me.id && b.break_type === t && new Date(b.started_at).toDateString() === today).length;
      return `${a.label}: ${Math.max(0, a.daily - used)}/${a.daily}`;
    });
    el.breakRemaining.textContent = "Remaining today — " + parts.join(" · ");
  }
  function updateBreakCountdown() {
    if (!currentBreak) return;
    const elapsed = Date.now() - new Date(currentBreak.started_at).getTime();
    const allowedMs = currentBreak.allowed_min * 60000;
    const remain = allowedMs - elapsed;
    const cls = remain < 0 ? "over" : (remain < 60000 ? "warn" : "");
    el.breakCountdown.className = "break-countdown " + cls;
    el.breakCountdown.innerHTML = remain > 0 ? `Remaining: ${UTIL.msToClock(remain)}` : `Overbreak: ${UTIL.msToClock(-remain)}`;
  }
  async function startBreakAction(type) {
    if (!currentSession || currentSession.status !== "active") { setMsg(el.trackerMsg, "Start tracking before a break.", "error"); return; }
    const res = API.startBreak(me.id, currentSession.id, type);
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    setMsg(el.trackerMsg, "", "");
    currentBreak = res.data;
    renderBreakUI();
  }
  function endBreakAction() {
    if (!currentBreak) return;
    const res = API.endBreak(me.id, currentBreak.id);
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    if (currentSession) currentSession.break_ms = (currentSession.break_ms||0) + (res.data.actual_ms||0);
    currentBreak = null;
    if (breakTimer) clearInterval(breakTimer);
    setMsg(el.trackerMsg,
      res.data.status === "overbreak" ? `Break over by ${UTIL.msToClock(res.data.overbreak_ms)} — flagged for review.` : "Break ended within allowance.",
      res.data.status === "overbreak" ? "error" : "ok");
    renderBreakUI(); refreshUI(); refreshToday();
  }

  /* ---------------- Activity sync ---------------- */
  function bindActivitySync() {
    let bucket = { at: new Date().toISOString(), mouse: 0, keys: 0 };
    const flush = () => {
      if (!currentSession) return;
      API.addActivity(me.id, currentSession.id, { at: bucket.at, mouse: bucket.mouse, keys: bucket.keys, active: 0, idle: 0 });
      bucket = { at: new Date().toISOString(), mouse: 0, keys: 0 };
    };
    const hook = () => bucket.keys++;
    document.addEventListener("keydown", hook, { passive: true });
    const mm = () => bucket.mouse++;
    document.addEventListener("mousemove", mm, { passive: true });
    setInterval(flush, 60000);
    window._activityRelease = () => {
      document.removeEventListener("keydown", hook);
      document.removeEventListener("mousemove", mm);
    };
  }

  /* ---------------- UI updates ---------------- */
  function refreshUI() {
    if (!me) return;
    const running = currentSession && currentSession.status === "active";
    const paused = currentSession && currentSession.status === "paused";
    el.start.hidden = !!currentSession;
    el.pause.hidden = !running;
    el.resume.hidden = !paused;
    el.stop.hidden = !currentSession;
    el.project.disabled = !!currentSession;
    el.task.disabled = !!currentSession;
    el.statusPill.textContent = paused ? "On Break" : (running ? (currentBreak ? "On Break" : "Working") : "Offline");
    el.statusPill.className = "pill " + (paused ? "p-warn" : (running ? "p-ok" : "p-muted"));
    if (running) startElapsed();
    else if (paused) { if (elapsedTimer) clearInterval(elapsedTimer); el.elapsed.textContent = UTIL.msToClock(currentSession ? (currentSession.break_ms||0) : 0); }
    else { if (elapsedTimer) clearInterval(elapsedTimer); el.elapsed.textContent = "00:00:00"; }
  }
  function startElapsed() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    const upd = () => {
      el.elapsed.textContent = UTIL.msToClock(currentSessionElapsed());
      const s = Activity.idleState();
      el.idleStatus.textContent = s.isIdle ? "Idle" : "Active";
      el.idleStatus.className = "stat-inline " + (s.isIdle ? "idle-on" : "");
    };
    upd();
    elapsedTimer = setInterval(upd, 1000);
  }
  function bindRunningState() {
    if (currentSession && currentSession.status === "active") {
      Activity.setOnIdleChange((isIdle) => {
        el.idleStatus.textContent = isIdle ? "Idle" : "Active";
        el.idleStatus.className = "stat-inline " + (isIdle ? "idle-on" : "");
      });
      Activity.configure({ idleThresholdMs: settings.idleThresholdMin * 60000 });
    }
  }

  async function logout() {
    if (currentSession && currentSession.status === "active") { await stopSession(); }
    if (window._activityRelease) { try { window._activityRelease(); } catch (e) {} }
    me = null; currentSession = null; currentBreak = null;
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (breakTimer) clearInterval(breakTimer);
    el.email.value = ""; el.pin.value = "";
    if (window.AUTH && AUTH.enabled()) { try { await AUTH.signOut(); } catch (e) {} }
    showView("login");
  }

  /* ---------------- wiring ---------------- */
  function init() {
    el.brandName.textContent = CFG.APP_NAME;
    el.trackerBrand.textContent = CFG.APP_NAME;
    bindDemoBanner();

    el.project.addEventListener("change", refreshTaskSelect);
    el.start.addEventListener("click", startSession);
    el.pause.addEventListener("click", () => {
      if (currentBreak) endBreakAction();
      else { setMsg(el.trackerMsg, "Select a break type below.", "ok"); renderBreakUI(); }
    });
    el.resume.addEventListener("click", resumeSession);
    el.stop.addEventListener("click", stopSession);
    el.logoutBtn.addEventListener("click", logout);
    el.breakPicker.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-break]");
      if (btn) startBreakAction(btn.dataset.break);
    });
    if (el.breakCountdown) el.breakCountdown.addEventListener("click", endBreakAction);

    // Demo login: enter with seeded demo employee (works with no Supabase setup).
    var demoEmp = document.getElementById("demoEmp");
    if (demoEmp) demoEmp.addEventListener("click", function (e) {
      e.preventDefault();
      var res = API.supabaseLogin("demo@oricle.local");
      if (!res.ok) return;
      me = res.data;
      if (el.userEmail) el.userEmail.textContent = me.email;
      var authO = document.getElementById("authOverlay"); if (authO) authO.style.display = "none";
      enterTracker();
    });

    setInterval(async () => {
      if (!me || me.role !== "employee") return;
      const r = API.myActive(me.id);
      if (r.ok && r.data && r.data.status === "active" && !currentSession) { currentSession = r.data; refreshUI(); renderBreakUI(); }
    }, 15000);

    if (window.AUTH && AUTH.enabled()) {
      showView("login");
      AUTH.setOnAuthorized((email) => ssoEnter(email));
    } else {
      showView("login");
    }
  }
  init();
})();
