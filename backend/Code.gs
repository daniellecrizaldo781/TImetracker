/**
 * ============================================================================
 * Time Tracker — Backend (Google Apps Script)
 * ============================================================================
 * This is the shared, server-side data layer for the time tracker. It is a
 * Web App backed by a Google Spreadsheet (the database) plus a Google Drive
 * folder for screenshots.
 *
 * DEPLOY (one time):
 *  1. Create a spreadsheet, note its ID, and a Drive folder, note its ID.
 *  2. Paste this file as a new Apps Script project (Extensions > Apps Script)
 *     attached to the spreadsheet.
 *  3. In code, set SPREADSHEET_ID and SCREENSHOT_FOLDER_ID below.
 *  4. Deploy > New deployment > type "Web app".
 *     - Execute as: Me
 *     - Who has access: "Anyone with Google account" (recommended — sessions
 *       are tied to employee accounts) OR "Anyone" for demo.
 *  5. Copy the /exec URL into js/config.js as BACKEND_URL.
 *
 * AUTH MODEL:
 *  - Employees authenticate with email + PIN. The PIN is stored as a simple
 *    hash here (not plaintext). A session token is returned and must be sent
 *    back on subsequent calls to authorize.
 *  - Admin authenticates with ADMIN_PASSWORD (also hashed here).
 *  - Screenshots are stored in a private Drive folder; only authorized admin
 *    calls may fetch them.
 *
 * SECURITY NOTES:
 *  - For production, deploy with "Who has access: Only myself", put this Web
 *    App behind your own auth gateway, or add an API key check. The token is
 *    a lightweight session marker, not a full auth system.
 * ============================================================================
 */

/* --- CONFIGURATION: set these before deploying --- */
var SPREADSHEET_ID = "YOUR_SPREADSHEET_ID";
var SCREENSHOT_FOLDER_ID = "YOUR_DRIVE_FOLDER_ID";
var ADMIN_PASSWORD = "change-me-admin";                 // plaintext only used to derive hash
var ADMIN_PASSWORD_HASH = "";                            // set after first run (see setup)

/* Simple token store: token -> {email, role, exp} */
var TOKENS = {}; // in-memory per-run; for durability use PropertiesService

var SHEETS = {
  employees: "Employees",
  projects: "Projects",
  tasks: "Tasks",
  sessions: "Sessions",
  activity: "Activity",
  screenshots: "Screenshots",
  settings: "Settings",
};

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, name: "Time Tracker backend", setup: SPREADSHEET_ID === "YOUR_SPREADSHEET_ID" ? false : true, time: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var out = { ok: false, error: "Unknown action" };
  try {
    if (SPREADSHEET_ID === "YOUR_SPREADSHEET_ID") {
      return json2({ ok: false, error: "Backend not configured yet: set SPREADSHEET_ID in Code.gs and redeploy." });
    }
    ensureSheets();
    out = route(body);
  } catch (err) {
    out = { ok: false, error: "Backend error: " + err.message };
  }
  return json2(out);
}

function json2(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function route(b) {
  var action = b.action;
  switch (action) {
    case "employeeLogin": return employeeLogin(b.email, b.pin);
    case "adminLogin": return adminLogin(b.password);
    case "me": return me(b);
    case "getProjectsTasks": return reqAuth(b, function(){ return getProjectsTasks(); });
    case "getEmployees": return reqAuth(b, function(){ return getEmployees(); });
    case "getSettings": return reqAuth(b, function(){ return getSettings(); });
    case "saveSettings": return reqAdmin(b, function(){ return saveSettings(b.settings); });
    case "startSession": return reqAuth(b, function(){ return startSession(userEmail(b), b.project, b.task); });
    case "pauseSession": return reqAuth(b, function(){ return pauseSession(userEmail(b)); });
    case "resumeSession": return reqAuth(b, function(){ return resumeSession(userEmail(b), b.project, b.task); });
    case "stopSession": return reqAuth(b, function(){ return stopSession(userEmail(b), b.activity, b.breakMs); });
    case "myActiveSession": return reqAuth(b, function(){ return myActiveSession(userEmail(b)); });
    case "postActivity": return reqAuth(b, function(){ return postActivity(b.sessionId, b.activity); });
    case "recordScreenshot": return reqAuth(b, function(){ return recordScreenshot(b.shot, userEmail(b)); });
    case "dashboard": return reqAdmin(b, function(){ return dashboard(b.empEmailFilter, b.statusFilter, b.from, b.to); });
    case "timesheets": return reqAdmin(b, function(){ return timesheets(b.empEmail, b.from, b.to); });
    case "reports": return reqAdmin(b, function(){ return reports(b.groupBy, b.from, b.to); });
    case "screenshots": return reqAdmin(b, function(){ return adminScreenshots(b.empEmail, b.from, b.to); });
    case "setup": return setup(b.confirm);
  }
  return { ok: false, error: "Unknown action" };
}

/* ============================ AUTH ============================ */

function reqAuth(b, fn) {
  if (!b.token || !TOKENS[b.token] || TOKENS[b.token].exp < Date.now()) {
    return { ok: false, error: "Not authorized. Please sign in again." };
  }
  return fn();
}
function reqAdmin(b, fn) {
  var t = b.token && TOKENS[b.token];
  if (!t || t.exp < Date.now() || t.role !== "admin") {
    return { ok: false, error: "Admin authorization required." };
  }
  return fn();
}
function userEmail(b) {
  return b.token && TOKENS[b.token] ? TOKENS[b.token].email : null;
}
function makeToken(email, role) {
  var tk = Utilities.getUuid();
  TOKENS[tk] = { email: email, role: role, exp: Date.now() + 12 * 3600 * 1000 }; // 12h
  return tk;
}
function hashPin(pin) {
  if (!pin) return "";
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin)
    .map(function(b){ return ("0" + ((b & 0xff).toString(16))).slice(-2); }).join("");
}
function ensureHashConfigured() {
  if (!ADMIN_PASSWORD_HASH && ADMIN_PASSWORD !== "change-me-admin") {
    ADMIN_PASSWORD_HASH = hashPin(ADMIN_PASSWORD);
  }
}

function employeeLogin(email, pin) {
  ensureHashConfigured();
  var rows = readSheet(SHEETS.employees, ["email", "name", "pinHash", "active"]);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].email || "").toLowerCase() === String(email || "").toLowerCase()) {
      if (rows[i].pinHash !== hashPin(pin)) return { ok: false, error: "Incorrect PIN." };
      if (rows[i].active === false) return { ok: false, error: "Account disabled." };
      return { ok: true, data: { role: "employee", empEmail: rows[i].email, name: rows[i].name, token: makeToken(rows[i].email, "employee") } };
    }
  }
  return { ok: false, error: "Employee not found." };
}

function adminLogin(password) {
  ensureHashConfigured();
  if (!ADMIN_PASSWORD_HASH && ADMIN_PASSWORD === "change-me-admin") {
    return { ok: false, error: "Admin password not configured. Set ADMIN_PASSWORD in Code.gs." };
  }
  if (hashPin(password) !== ADMIN_PASSWORD_HASH) return { ok: false, error: "Incorrect admin password." };
  return { ok: true, data: { role: "admin", token: makeToken("admin", "admin") } };
}

function me(b) {
  var t = b.token && TOKENS[b.token];
  if (!t || t.exp < Date.now()) return { ok: true, data: null };
  return { ok: true, data: { role: t.role, empEmail: t.email } };
}

/* ============================ DATA HELPERS ============================ */

function ss() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function ensureSheets() {
  var s = ss();
  var headers = {
    employees: ["email", "name", "pinHash", "active"],
    projects: ["id", "name", "archived"],
    tasks: ["id", "projectId", "name", "archived"],
    sessions: ["id", "empEmail", "project", "task", "start", "end", "status", "activityPct", "breakMs"],
    activity: ["sessionId", "ts", "activeIntervals", "totalIntervals", "idleMs"],
    screenshots: ["id", "sessionId", "empEmail", "project", "task", "ts", "fileId", "intervalMin"],
    settings: ["key", "value"],
  };
  for (var sheetName in headers) {
    var sheet = s.getSheetByName(sheetName);
    if (!sheet) {
      sheet = s.insertSheet(sheetName);
      sheet.appendRow(headers[sheetName]);
    } else if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers[sheetName]);
    }
  }
  // ensure screenshot folder config
  if (SCREENSHOT_FOLDER_ID === "YOUR_DRIVE_FOLDER_ID") {
    // non-fatal; gallery just won't populate
  }
}

function readSheet(name, cols) {
  var sheet = ss().getSheetByName(name);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return [];
  var vals = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var obj = {};
    for (var c = 0; c < hdr.length; c++) {
      obj[hdr[c]] = vals[r][c];
    }
    out.push(obj);
  }
  return out;
}

function appendRow(name, rows) {
  var sheet = ss().getSheetByName(name);
  rows.forEach(function (row) {
    sheet.appendRow(row);
  });
}

function updateRowById(name, id, patch) {
  var cols = null, sheet = ss().getSheetByName(name);
  if (!sheet) return false;
  var lastCol = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  var vals = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var r = 0; r < vals.length; r++) {
    if (String(vals[r][0]) === String(id)) {
      for (var key in patch) {
        var ci = hdr.indexOf(key);
        if (ci >= 0) sheet.getRange(r + 2, ci + 1).setValue(patch[key]);
      }
      return true;
    }
  }
  return false;
}

function rowToObjWithHeader(vals, hdr) {
  var obj = {};
  for (var c = 0; c < hdr.length; c++) obj[hdr[c]] = vals[c];
  return obj;
}

/* ============================ META ============================ */

function getProjectsTasks() {
  var projects = readSheet(SHEETS.projects, ["id", "name", "archived"]).filter(function (p) { return p.archived !== true; });
  var tasks = readSheet(SHEETS.tasks, ["id", "projectId", "name", "archived"]).filter(function (t) { return t.archived !== true; });
  return { ok: true, data: { projects: projects, tasks: tasks } };
}

function getEmployees() {
  var rows = readSheet(SHEETS.employees, ["email", "name", "pinHash", "active"]);
  return { ok: true, data: rows.map(function (r) { return { email: r.email, name: r.name, active: r.active !== false }; }) };
}

function getSettings() {
  var rows = readSheet(SHEETS.settings, ["key", "value"]);
  var map = {};
  rows.forEach(function (r) { map[r.key] = r.value; });
  return { ok: true, data: {
    screenshotIntervalMin: Number(map.screenshotIntervalMin || 10),
    idleThresholdMin: Number(map.idleThresholdMin || 5),
    deductIdleTime: map.deductIdleTime === "true" || map.deductIdleTime === true,
  } };
}

function saveSettings(s) {
  var vals = [
    ["screenshotIntervalMin", String(s.screenshotIntervalMin)],
    ["idleThresholdMin", String(s.idleThresholdMin)],
    ["deductIdleTime", String(!!s.deductIdleTime)],
  ];
  var sheet = ss().getSheetByName(SHEETS.settings);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
  vals.forEach(function (v) { sheet.appendRow(v); });
  return getSettings();
}

/* ============================ SESSIONS ============================ */

function findActiveByEmail(email) {
  var rows = readSheet(SHEETS.sessions, ["id", "empEmail", "project", "task", "start", "end", "status", "activityPct", "breakMs"]);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].empEmail || "").toLowerCase() === String(email || "").toLowerCase() &&
        (rows[i].status === "active" || rows[i].status === "paused")) {
      rows[i].breakMs = Number(rows[i].breakMs) || 0;
      return rows[i];
    }
  }
  return null;
}

function startSession(email, project, task) {
  if (findActiveByEmail(email)) return { ok: false, error: "A session is already active for this employee. Stop or resume it first." };
  var id = "s" + Utilities.getUuid();
  appendRow(SHEETS.sessions, [[id, email, project, task, new Date().toISOString(), "", "active", "", 0]]);
  return { ok: true, data: { id: id, empEmail: email, project: project, task: task, start: new Date().toISOString(), status: "active", breakMs: 0, end: "", activityPct: null } };
}

function pauseSession(email) {
  var s = findActiveByEmail(email);
  if (!s) return { ok: false, error: "No active session to pause." };
  if (s.status !== "active") return { ok: false, error: "Session is not running." };
  // an active session does not track break separately here as start/end; keep breakMs for future
  updateRowById(SHEETS.sessions, s.id, { status: "paused" });
  return { ok: true, data: Object.assign(s, { status: "paused" }) };
}

function resumeSession(email, project, task) {
  var s = findActiveByEmail(email);
  if (!s) return { ok: false, error: "No paused session." };
  updateRowById(SHEETS.sessions, s.id, { status: "active", project: project || s.project, task: task || s.task });
  return { ok: true, data: Object.assign(s, { status: "active", project: project || s.project, task: task || s.task }) };
}

function stopSession(email, activity, breakMs) {
  var s = findActiveByEmail(email);
  if (!s) return { ok: false, error: "No active session." };
  var end = new Date().toISOString();
  var pct = activity && activity.pct != null ? activity.pct : 50;
  var brk = Number(breakMs) || Number(s.breakMs) || 0;
  updateRowById(SHEETS.sessions, s.id, { end: end, status: "completed", activityPct: pct, breakMs: brk });
  return { ok: true, data: Object.assign(s, { end: end, status: "completed", activityPct: pct, breakMs: brk }) };
}

function myActiveSession(email) {
  var s = findActiveByEmail(email);
  if (!s) return { ok: true, data: null };
  return okData(s);
}
function okData(d) { return { ok: true, data: d }; }

function postActivity(sessionId, activity) {
  // store an aggregated sample per session (lightweight), not raw keystrokes.
  appendRow(SHEETS.activity, [[sessionId, new Date().toISOString(),
    Number(activity.activeIntervals) || 0, Number(activity.totalIntervals) || 0, Number(activity.idleMs) || 0]]);
  return { ok: true, data: true };
}

/* ============================ SCREENSHOTS ============================ */

function recordScreenshot(shot, email) {
  // In browser, the employee captures a dataURL frame. For a Web App we cannot
  // receive huge base64 inline on the same call reliably; we store a lightweight
  // record pointing to the attachment if provided. The screenshot image may be
  // uploaded separately (see docs). If only metadata arrives, still record it so
  // the gallery shows the association.
  var fileId = "";
  if (shot.dataUrl) {
    try {
      var blob = Utilities.newBlob(Utilities.base64Decode(shot.dataUrl.split(",")[1] || ""), "image/jpeg", "shot-" + Date.now() + ".jpg");
      var folder = DriveApp.getFolderById(SCREENSHOT_FOLDER_ID);
      var file = folder.createFile(blob);
      fileId = file.getId();
    } catch (err) {
      fileId = ""; // no drive config or too large — but never fake a screenshot
    }
  }
  var id = "shot" + Utilities.getUuid();
  appendRow(SHEETS.screenshots, [[id, shot.sessionId || "", email || shot.empEmail || "", shot.project || "", shot.task || "",
    shot.ts || new Date().toISOString(), fileId, Number(shot.intervalMin) || 10]]);
  return { ok: true, data: { id: id, fileId: fileId, saved: !!fileId } };
}

function adminScreenshots(empEmail, from, to) {
  var rows = readSheet(SHEETS.screenshots, ["id", "sessionId", "empEmail", "project", "task", "ts", "fileId", "intervalMin"]);
  var toDate = to ? new Date(to + "T23:59:59") : null;
  var fromDate = from ? new Date(from + "T00:00:00") : null;
  var out = rows.filter(function (r) {
    if (empEmail && String(r.empEmail || "").toLowerCase() !== String(empEmail).toLowerCase()) return false;
    var t = new Date(r.ts).getTime();
    if (fromDate && t < fromDate.getTime()) return false;
    if (toDate && t > toDate.getTime()) return false;
    return r.fileId ? true : false;  // only show actually-saved images
  }).map(function (r) {
    var url = "";
    if (r.fileId) {
      try {
        url = DriveApp.getFileById(r.fileId).getBlob().getBytes().map(function (b) { return String.fromCharCode(b); }).join("");
        url = "data:image/jpeg;base64," + Utilities.base64Encode(Utilities.newBlob(url).getBytes());
      } catch (e2) { url = ""; }
    }
    return { id: r.id, sessionId: r.sessionId, empEmail: r.empEmail, project: r.project, task: r.task, ts: r.ts, dataUrl: url };
  }).sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
  return { ok: true, data: out };
}

/* ============================ ADMIN DASHBOARD ============================ */

function dashboard(empEmailFilter, statusFilter, from, to) {
  var sessions = readSheet(SHEETS.sessions, ["id", "empEmail", "project", "task", "start", "end", "status", "activityPct", "breakMs"]);
  var toDate = to ? new Date(to + "T23:59:59").getTime() : null;
  var fromDate = from ? new Date(from + "T00:00:00").getTime() : null;
  var filtered = sessions.filter(function (s) {
    if (empEmailFilter && String(s.empEmail || "").toLowerCase() !== String(empEmailFilter).toLowerCase()) return false;
    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "active" && s.status !== "active") return false;
      if (statusFilter === "paused" && s.status !== "paused") return false;
      if (statusFilter === "completed" && s.status !== "completed") return false;
    }
    var t = new Date(s.start).getTime();
    if (fromDate && t < fromDate) return false;
    if (toDate && t > toDate) return false;
    return true;
  });
  var employees = getEmployees().data;
  var live = { active: 0, idle: 0, break_: 0, offline: 0 };
  employees.forEach(function (e) {
    var s = findActiveByEmail(e.email);
    if (!s) live.offline++;
    else if (s.status === "paused") live.break_++;
    else live.active++;
  });
  var totalMs = 0;
  filtered.forEach(function (s) {
    var end = s.end ? new Date(s.end).getTime() : Date.now();
    totalMs += Math.max(0, end - new Date(s.start).getTime() - (Number(s.breakMs) || 0));
  });
  return { ok: true, data: { sessions: filtered, live: live, totalMs: totalMs } };
}

function timesheets(empEmail, from, to) {
  var d = dashboard(empEmail, "all", from, to);
  return { ok: true, data: d.data.sessions };
}

function reports(groupBy, from, to) {
  var d = dashboard("", "all", from, to);
  var buckets = {};
  d.data.sessions.forEach(function (s) {
    var dt = new Date(s.start);
    var key;
    if (groupBy === "day") key = dt.toISOString().slice(0, 10);
    else if (groupBy === "week") { var day = (dt.getDay() + 6) % 7; var m = new Date(dt); m.setDate(dt.getDate() - day); key = m.toISOString().slice(0, 10); }
    else if (groupBy === "month") key = dt.toISOString().slice(0, 7);
    else if (groupBy === "employee") key = s.empEmail || "Unknown";
    else if (groupBy === "project") key = s.project || "Unknown";
    else key = "all";
    var end = s.end ? new Date(s.end).getTime() : Date.now();
    if (!buckets[key]) buckets[key] = 0;
    buckets[key] += Math.max(0, end - new Date(s.start).getTime() - (Number(s.breakMs) || 0));
  });
  return { ok: true, data: buckets };
}

/* ============================ SETUP ============================ */

function setup(confirm) {
  if (confirm !== "YES") return { ok: false, error: "Call setup with confirm='YES' to create the schema and seed admin." };
  ensureSheets();
  ensureHashConfigured();
  if (!ADMIN_PASSWORD_HASH) return { ok: false, error: "Set ADMIN_PASSWORD in Code.gs first." };
  // add an admin marker row in settings
  var s = ss().getSheetByName(SHEETS.settings);
  s.appendRow(["adminPasswordHash", ADMIN_PASSWORD_HASH]);
  return { ok: true, data: { note: "Schema ready. Add employees by inserting rows into the Employees sheet (email, name, pinHash=SHA256(pin), active=TRUE)." } };
}

/* Trigger to auto-seed admin hash on first deploy */
function onOpen() { ensureHashConfigured(); }
