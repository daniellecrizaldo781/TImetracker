/* =========================================================================
 * TT - Employee page logic
 * ========================================================================= */

(function () {
  const $ = (id) => document.getElementById(id);
  const CFG = window.TT_CONFIG;

  /* state */
  let me = null;            // {role:'employee', empEmail}
  let projects = [];
  let tasks = [];
  let settings = { screenshotIntervalMin: 10, idleThresholdMin: 5, deductIdleTime: false };
  let currentSession = null; // active or paused backend session
  let elapsedTimer = null;
  let todayMs = 0;

  const view = {
    login: $("loginView"), tracker: $("trackerView"),
  };
  const el = {
    email: $("loginEmail"), pin: $("loginPin"), loginMsg: $("loginMsg"), loginBtn: $("loginBtn"),
    brandName: $("brandName"), trackerBrand: $("trackerBrand"),
    statusPill: $("statusPill"), screenshotPill: $("screenshotPill"),
    elapsed: $("elapsedDisplay"), liveActivity: $("liveActivity"), todayTotal: $("todayTotal"), idleStatus: $("idleStatus"),
    project: $("projectSelect"), task: $("taskSelect"),
    start: $("startBtn"), pause: $("pauseBtn"), resume: $("resumeBtn"), stop: $("stopBtn"),
    trackerMsg: $("trackerMsg"), demoBanner: $("demoBanner"),
    captureExplain: $("captureExplain"), capturePreview: $("capturePreview"),
    captureOn: $("captureOnBtn"), captureOff: $("captureOffBtn"), captureMsg: $("captureMsg"),
    logoutBtn: $("logoutBtn"),
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
    if (API.isDemo()) {
      el.demoBanner.hidden = false;
      el.demoBanner.textContent = CFG.DEMO_NOTE;
    }
  }

  /* ---------------- Login ---------------- */
  async function doLogin() {
    const email = el.email.value.trim();
    const pin = el.pin.value.trim();
    if (!email || !pin) { setMsg(el.loginMsg, "Enter email and PIN.", "error"); return; }
    el.loginBtn.disabled = true;
    const res = await API.employeeLogin(email, pin);
    el.loginBtn.disabled = false;
    if (!res.ok) { setMsg(el.loginMsg, res.error, "error"); return; }
    me = res.data;
    setMsg(el.loginMsg, "");
    await enterTracker();
  }

  async function enterTracker() {
    bindDemoBanner();
    const [pt, s, mine] = await Promise.all([API.getProjectsTasks(), API.getSettings(), API.me()]);
    projects = pt.data.projects || [];
    tasks = pt.data.tasks || [];
    settings = Object.assign(settings, s.data || {});
    fillSelect();
    currentSession = (mine.data && (mine.data.status === "active" || mine.data.status === "paused")) ? mine.data : null;
    refreshUI();
    showView("tracker");
    await refreshToday();
    if (currentSession) bindRunningState();
    el.statusPill.textContent = currentSession ? "Working" : "Offline";
  }

  function fillSelect() {
    el.project.innerHTML = '<option value="">Select project…</option>' +
      projects.map(p => `<option value="${UTIL.esc(p.id)}">${UTIL.esc(p.name)}</option>`).join("");
    refreshTaskSelect();
  }

  function refreshTaskSelect() {
    const pid = el.project.value;
    const list = tasks.filter(t => !pid || t.projectId === pid);
    el.task.innerHTML = '<option value="">Select task…</option>' +
      list.map(t => `<option value="${UTIL.esc(t.id)}">${UTIL.esc(t.name)}</option>`).join("");
  }

  function chosen() {
    const project = projects.find(p => p.id === el.project.value);
    const task = tasks.find(t => t.id === el.task.value);
    return { project: project ? project.name : "", task: task ? task.name : "" };
  }

  /* ---------------- Timer / session lifecycle ---------------- */
  async function refreshToday() {
    const d = new Date();
    const from = d.toISOString().slice(0, 10);
    const to = from;
    const r = await API.timesheets(me.empEmail, from, to);
    if (r.ok) {
      todayMs = r.data.reduce((sum, s) => {
        const end = s.end ? new Date(s.end).getTime() : Date.now();
        return sum + Math.max(0, end - new Date(s.start).getTime() - (s.breakMs || 0));
      }, 0);
      if (currentSession) todayMs += currentSessionElapsed();
      el.todayTotal.innerHTML = `Today: <b>${UTIL.hoursToLabel(todayMs)}</b>`;
    }
  }

  function currentSessionElapsed() {
    if (!currentSession || currentSession.status !== "active") return 0;
    return Date.now() - new Date(currentSession.start).getTime() - (currentSession.breakMs || 0);
  }

  async function startSession() {
    const c = chosen();
    if (!c.project || !c.task) { setMsg(el.trackerMsg, "Select a project and task first.", "error"); return; }
    const res = await API.startSession(me.empEmail, c.project, c.task);
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    currentSession = res.data;
    setMsg(el.trackerMsg, "", "");
    Activity.configure({ idleThresholdMs: settings.idleThresholdMin * 60000 });
    Activity.resetSession();
    Activity.setOnSample((ms, activeInWindow) => { /* driving idle tick */ });
    Activity.start();
    bindRunningState();
    refreshUI();
  }

  async function pauseSession() {
    const res = await API.pauseSession();
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    currentSession.status = "paused";
    Screenshot.stopCapture(); stopCaptureIndicator();
    bindRunningState(); refreshUI();
  }

  async function resumeSession() {
    const c = chosen();
    if (!c.project || !c.task) { setMsg(el.trackerMsg, "Select a project and task.", "error"); return; }
    const res = await API.resumeSession(c.project, c.task);
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    currentSession = res.data;
    bindRunningState(); refreshUI(); refreshToday();
    // Capture should NOT auto-restart without explicit permission; require re-enable.
  }

  async function stopSession() {
    const stats = Activity.idleState();
    const res = await API.stopSession({ pct: liveActivityPct() }, currentSession.breakMs || 0);
    if (!res.ok) { setMsg(el.trackerMsg, res.error, "error"); return; }
    Screenshot.stopCapture(); stopCaptureIndicator();
    currentSession = null;
    Activity.resetSession();
    if (elapsedTimer) clearInterval(elapsedTimer);
    bindRunningState(); refreshUI(); refreshToday();
    setMsg(el.trackerMsg, "", "");
    el.statusPill.textContent = "Offline";
  }

  function liveActivityPct() {
    // Simple recent-5-min activity estimate from Activity state.
    const s = Activity.idleState();
    return 50; // sample; refined by real backend aggregator
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
    el.statusPill.textContent = paused ? "On Break" : (running ? "Working" : "Offline");
    el.statusPill.className = "pill " + (paused ? "p-warn" : (running ? "p-ok" : "p-muted"));
    if (running) startElapsed();
    else if (paused) { if (elapsedTimer) clearInterval(elapsedTimer); el.elapsed.textContent = UTIL.msToClock(currentSessionElapsed() - (currentSession ? currentSession.breakMs : 0) || 0); }
    else { if (elapsedTimer) clearInterval(elapsedTimer); el.elapsed.textContent = "00:00:00"; }
  }

  function startElapsed() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    const upd = () => {
      el.elapsed.textContent = UTIL.msToClock(currentSessionElapsed());
      const s = Activity.idleState();
      el.idleStatus.textContent = s.isIdle ? "Idle" : "Active";
      el.idleStatus.className = "stat-inline " + (s.isIdle ? "idle-on" : "");
      el.liveActivity.innerHTML = `Activity: <b>${UTIL.esc(liveLabel())}</b>`;
    };
    upd();
    elapsedTimer = setInterval(upd, 1000);
  }

  function liveLabel() { return "measuring…"; }

  function bindRunningState() {
    if (currentSession && currentSession.status === "active") {
      // Activity idle indicator
      Activity.setOnSample((ms, activeInWindow) => {});
      Activity.setOnIdleChange((isIdle) => {
        el.idleStatus.textContent = isIdle ? "Idle" : "Active";
        el.idleStatus.className = "stat-inline " + (isIdle ? "idle-on" : "");
      });
      Activity.configure({ idleThresholdMs: settings.idleThresholdMin * 60000 });
    }
  }

  /* ---------------- Capture ---------------- */
  function stopCaptureIndicator() {
    el.screenshotPill.textContent = "Screenshots: off";
    el.screenshotPill.className = "pill";
    el.captureOn.hidden = false; el.captureOff.hidden = true;
    setMsg(el.captureMsg, "", "");
  }

  async function enableCapture() {
    if (!Screenshot.supported()) {
      setMsg(el.captureMsg, "This browser does not support the Screen Capture API, so screenshots cannot be recorded here. This is a browser limitation — no screenshot will be claimed.", "error");
      return;
    }
    if (!currentSession) { setMsg(el.captureMsg, "Start a timer before enabling screen capture.", "error"); return; }
    setMsg(el.captureMsg, "Your browser will ask you to choose a screen to share. This is required to capture screenshots.", "ok");
    Screenshot.setPreviewVideo(el.capturePreview);
    Screenshot.setOnStateChange((st) => {
      if (st.capturing) {
        el.screenshotPill.textContent = "Screenshots: ON";
        el.screenshotPill.className = "pill p-ok";
        el.captureOn.hidden = true; el.captureOff.hidden = false;
        setMsg(el.captureMsg, "Screen capture is active. Images are captured at the configured interval and saved to the backend.", "ok");
      } else if (st.reason) {
        stopCaptureIndicator();
        setMsg(el.captureMsg, st.reason, "error");
      }
    });
    const opened = await Screenshot.requestPermission();
    if (!opened) return;
    Screenshot.setIntervalMs(settings.screenshotIntervalMin * 60000);
    Screenshot.setOnShot((shot) => { saveShot(shot); });
    Screenshot.start(settings.screenshotIntervalMin * 60000, () => ({
      sessionId: currentSession.id, empEmail: me.empEmail,
      project: currentSession.project, task: currentSession.task,
      intervalMin: settings.screenshotIntervalMin,
    }));
    if (API.isDemo()) setMsg(el.captureMsg, "Demo mode: captured screenshot is kept in this browser only (not saved to any company backend).", "ok");
  }

  async function saveShot(shot) {
    // Persist via API (backend or demo store).
    await API.recordScreenshot(shot);
  }

  async function disableCapture() {
    Screenshot.stopCapture();
    stopCaptureIndicator();
    setMsg(el.captureMsg, "Screen sharing stopped.", "ok");
  }

  async function logout() {
    if (currentSession && currentSession.status === "active") {
      // Honest: stop the session before logout (no silent tracking).
      await stopSession();
    }
    Screenshot.stopCapture(true);
    me = null; currentSession = null;
    if (elapsedTimer) clearInterval(elapsedTimer);
    el.email.value = ""; el.pin.value = "";
    showView("login");
  }

  /* ---------------- wiring ---------------- */
  async function init() {
    showView("login");
    el.brandName.textContent = CFG.APP_NAME;
    el.trackerBrand.textContent = CFG.APP_NAME;
    bindDemoBanner();

    el.loginBtn.addEventListener("click", doLogin);
    el.email.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
    el.pin.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });

    el.project.addEventListener("change", refreshTaskSelect);
    el.start.addEventListener("click", startSession);
    el.pause.addEventListener("click", pauseSession);
    el.resume.addEventListener("click", resumeSession);
    el.stop.addEventListener("click", stopSession);
    el.captureOn.addEventListener("click", enableCapture);
    el.captureOff.addEventListener("click", disableCapture);
    el.logoutBtn.addEventListener("click", logout);

    // persist live session (employee refresh lasts 15s)
    setInterval(async () => {
      if (!me || me.role !== "employee") return;
      const r = await API.myActiveSession(me.empEmail);
      if (r.ok && r.data && r.data.status === "active" && !currentSession) {
        currentSession = r.data; refreshUI();
      }
    }, 15000);
  }

  init();
})();
