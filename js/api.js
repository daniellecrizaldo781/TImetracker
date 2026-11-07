/* =========================================================================
 * TT - API layer
 * One interface used by the whole app. When TT_CONFIG.BACKEND_URL is set it
 * talks to the Google Apps Script backend (real, shared, synced). When it is
 * empty the app runs in DEMO MODE backed by LocalStore (clearly labeled,
 * local-only, never presented as real tracking).
 * Every call returns a Promise<{ok:boolean, data?:any, error?:string}>.
 * ========================================================================= */

const API = (() => {
  const CFG = window.TT_CONFIG;

  function isDemo() {
    return !CFG.BACKEND_URL;
  }

  /* ---- common result helpers ---- */
  function ok(data) { return Promise.resolve({ ok: true, data }); }
  function fail(error) { return Promise.resolve({ ok: false, error }); }

  /* ---- backend transport ---- */
  async function backendCall(action, payload) {
    try {
      const res = await fetch(CFG.BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, ...payload }),
      });
      let json;
      try { json = await res.json(); }
      catch (e) { return fail("Backend returned a non-JSON response (check that the Apps Script Web App is deployed and accessible)."); }
      if (json && json.ok === false) return fail(json.error || "Backend error");
      return ok(json && json.data !== undefined ? json.data : json);
    } catch (e) {
      return fail("Cannot reach the backend. Check network / BACKEND_URL. Raw: " + e.message);
    }
  }

  /* ========================================================================
   * PUBLIC API
   * ====================================================================== */
  return {
    isDemo,

    /* ---- auth ---- */
    employeeLogin(email, pin) {
      if (isDemo()) return LocalStore.employeeLogin(email, pin);
      return backendCall("employeeLogin", { email, pin });
    },
    adminLogin(password) {
      if (isDemo()) return LocalStore.adminLogin(password);
      return backendCall("adminLogin", { password });
    },
    me() {
      if (isDemo()) return LocalStore.me();
      return backendCall("me", {});
    },

    /* ---- meta (projects / tasks / employees / settings) ---- */
    getProjectsTasks() {
      if (isDemo()) return LocalStore.getProjectsTasks();
      return backendCall("getProjectsTasks", {});
    },
    getEmployees() {
      if (isDemo()) return LocalStore.getEmployees();
      return backendCall("getEmployees", {});
    },
    getSettings() {
      if (isDemo()) return LocalStore.getSettings();
      return backendCall("getSettings", {});
    },
    saveSettings(s) {
      if (isDemo()) return LocalStore.saveSettings(s);
      return backendCall("saveSettings", { settings: s });
    },

    /* ---- sessions ---- */
    startSession(empEmail, project, task) {
      if (isDemo()) return LocalStore.startSession(empEmail, project, task);
      return backendCall("startSession", { empEmail, project, task });
    },
    pauseSession() {
      if (isDemo()) return LocalStore.pauseSession();
      return backendCall("pauseSession", {});
    },
    resumeSession(project, task) {
      if (isDemo()) return LocalStore.resumeSession(project, task);
      return backendCall("resumeSession", { project, task });
    },
    stopSession(activity, breakMs) {
      if (isDemo()) return LocalStore.stopSession(activity, breakMs);
      return backendCall("stopSession", { activity, breakMs });
    },
    myActiveSession(empEmail) {
      if (isDemo()) return LocalStore.myActiveSession(empEmail);
      return backendCall("myActiveSession", { empEmail });
    },
    postActivity(sessionId, activity) {
      if (isDemo()) return ok(true);
      return backendCall("postActivity", { sessionId, activity });
    },
    recordScreenshot(shot) {
      if (isDemo()) return LocalStore.recordScreenshot(shot);
      return backendCall("recordScreenshot", { shot });
    },

    /* ---- admin dashboard ---- */
    dashboard(empEmailFilter, statusFilter, from, to) {
      if (isDemo()) return LocalStore.dashboard(empEmailFilter, statusFilter, from, to);
      return backendCall("dashboard", { empEmailFilter, statusFilter, from, to });
    },
    timesheets(empEmail, from, to) {
      if (isDemo()) return LocalStore.timesheets(empEmail, from, to);
      return backendCall("timesheets", { empEmail, from, to });
    },
    reports(groupBy, from, to) {
      if (isDemo()) return LocalStore.reports(groupBy, from, to);
      return backendCall("reports", { groupBy, from, to });
    },
    screenshots(empEmail, from, to) {
      if (isDemo()) return LocalStore.screenshots(empEmail, from, to);
      return backendCall("screenshots", { empEmail, from, to });
    },
  };
})();
