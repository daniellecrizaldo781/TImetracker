/* =========================================================================
 * TT - API layer. One interface for the whole app. When BACKEND_URL is set it
 * talks to the Google Apps Script backend; when empty (default) it uses the
 * Demo Store (Store) which mirrors the Supabase schema. Auth (login) is
 * handled by Supabase via js/auth.js regardless of data layer.
 * Every call returns { ok, data?, error? }.
 * ========================================================================= */

const API = Store; // demo mode: Store implements the same interface

/* Backward-compat helpers used by existing UI code. */
API.isDemo = () => true;                 // demo data mode until a backend is configured
API.employeeLogin = (email) => API.loginSupabaseUser(email);
API.supabaseLogin = (email, meta) => API.loginSupabaseUser(email);
API.getProjectsTasks = () => API.refs();
API.getSettings = (...a) => API.settings(...a);
API.addActivity = (...a) => API.addActivity(...a);
API.listSchedules = (...a) => API.listSchedules(...a);
API.attendanceAll = (...a) => API.attendanceAll(...a);

/* In live mode we would point these at a transport talking to Supabase/GAS. */

