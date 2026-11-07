/* =========================================================================
 * TT - live.js  (Supabase data adapter — read + write-through)
 * - PULL: reads employees/teams/projects/tasks from the real Supabase project
 *   and merges them into the demo Store so the tracker shows real data.
 * - PUSH: writes admin-created/edited projects & tasks back to Supabase so
 *   they sync to every device (projects/tasks have no direct insert policy, so
 *   pushes go through SECURITY DEFINER RPCs — see backend/live_rpc.sql).
 *
 * All network calls are TIMEOUT-BOUNDED so a slow/hanging Supabase can never
 * block login or the dashboard (the earlier "admin login glitches, pages won't
 * open" bug: enterDash awaited an unbounded sync).
 * ========================================================================= */

const LIVE = (() => {

  function enabled() {
    return !!(window.supabase && window.TT_CONFIG && window.TT_CONFIG.supabaseUrl && window.TT_CONFIG.supabaseAnonKey);
  }

  /* Store/API are top-level `const`s (script globals) — reachable as bare
     identifiers, NOT as window.Store/window.API (those are undefined, which
     broke the live merge: 'Cannot read properties of undefined (_raw)'). */
  function store() {
    try {
      if (typeof API !== 'undefined') return API;
      if (typeof Store !== 'undefined') return Store;
    } catch (e) {}
    return window.API || window.Store || null;
  }

  function raw() {
    const s = store();
    return (s && s._raw) ? s._raw : null;
  }

  function client() {
    if (!enabled()) return null;
    return window.supabase.createClient(
      window.TT_CONFIG.supabaseUrl,
      window.TT_CONFIG.supabaseAnonKey
    );
  }

  /* Bound any promise to a timeout (ms) so the caller can never hang. */
  function withTimeout(promise, ms) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, rej) => setTimeout(() => rej(new Error('supabase timeout')), ms || 6000)),
    ]);
  }

  /* Fetch rows; return [] on failure so callers degrade gracefully. */
  async function fetchAll(table, select) {
    try {
      const sb = client();
      if (!sb) return [];
      const { data, error } = await withTimeout(sb.from(table).select(select || "*"), 6000);
      if (error) { console.warn('LIVE fetch ' + table, error.message); return []; }
      return data || [];
    } catch (e) { console.warn('LIVE fetch ' + table, e.message); return []; }
  }

  function mapEmployee(r) {
    return {
      id: r.id, email: r.email, full_name: r.full_name || r.email, role: r.role || 'employee',
      hourly_rate: Number(r.hourly_rate) || 0, currency: r.currency || 'PHP',
      team: r.team || '', is_active: r.is_active !== false, created_at: r.created_at,
      _src: 'supabase',
    };
  }

  async function pull() {
    const [emps, teams, projects, tasks] = await Promise.all([
      fetchAll('employees', 'id,email,full_name,role,hourly_rate,currency,team,is_active,created_at'),
      fetchAll('teams', 'id,name'),
      fetchAll('projects', 'id,name,is_archived,created_at'),
      fetchAll('tasks', 'id,project_id,name,is_archived'),
    ]);
    return {
      employees: emps.map(mapEmployee),
      teams: teams.map(t => ({ id: t.id, name: t.name })),
      projects: projects.map(p => Object.assign({ id: p.id, name: p.name, is_archived: !!p.is_archived }, p)),
      tasks: tasks.map(t => Object.assign({ id: t.id, project_id: t.project_id, name: t.name, is_archived: !!t.is_archived }, t)),
    };
  }

  /* Timeout-bounded syncIntoStore. */
  async function syncIntoStore() {
    return withTimeout(doSync(), 8000);
  }

  async function doSync() {
    const snap = await pull();
    const DB = raw();
    if (!DB) return { ok: false, note: 'store not ready' };
    if (!snap.employees.length && !snap.projects.length) {
      DB._liveSync = { ok: false, note: 'Supabase returned no data yet (empty tables or not authed).' };
      return { ok: false, note: 'empty' };
    }
    if (snap.employees.length) {
      snap.employees.forEach(live => {
        const existing = DB.employees.find(e => e.id === live.id || (e.email||'').toLowerCase() === (live.email||'').toLowerCase());
        if (existing) { Object.assign(existing, live); existing._src = 'supabase'; }
        else DB.employees.push(live);
      });
      DB.employees.forEach(e => { if (e._src !== 'supabase') e._src = 'demo'; });
    }
    if (snap.teams.length) {
      const set = DB.settings.teams = DB.settings.teams || [];
      snap.teams.forEach(t => { if (!set.some(x => x.id === t.id)) set.push(t); });
    }
    // Only clobber demo projects/tasks with live ones when Supabase actually
    // has them. Keep demo-only projects (they'll be pushed on the next save).
    if (snap.projects.length) {
      const liveNames = snap.projects.map(p => String(p.name||'').toLowerCase());
      const kept = DB.projects.filter(p => !liveNames.includes(String(p.name||'').toLowerCase()));
      DB.projects = snap.projects.concat(kept);
      DB._livePush = (DB._livePush||[]).concat(kept);
    }
    if (snap.tasks.length && snap.projects.length) DB.tasks = snap.tasks;
    DB._liveSync = { ok: true, at: new Date().toISOString(), employees: snap.employees.length, projects: snap.projects.length };
    return { ok: true, data: DB._liveSync };
  }

  /* ---------------- WRITE-THROUGH (admin saves -> Supabase) ---------------- */

  function rpc(name, body, timeoutMs) {
    return withTimeout((async () => {
      const sb = client();
      if (!sb) return false;
      const { error } = await sb.rpc(name, body || {});
      if (error) { console.warn('LIVE rpc ' + name, error.message); return false; }
      return true;
    })(), timeoutMs || 6000);
  }

  /* Push the current (post-edit) project + task lists up to Supabase via RPC.
     Idempotent by name. Returns {ok, pushedProjectCount, pushedTaskCount}. */
  async function syncProjectsUp() {
    const DB = raw();
    if (!DB) return { ok: false };
    const projects = (DB.projects||[]).map(p => ({ name: p.name || '', is_archived: !!p.is_archived }));
    const tasks = (DB.tasks||[]).map(t => ({
      project_name: (DB.projects.find(p=>p.id===t.project_id)||{}).name || '',
      name: t.name || '', is_archived: !!t.is_archived,
    })).filter(t=>t.project_name);
    const ok = await rpc('tt_sync_projects_tasks', { p_projects: projects, p_tasks: tasks }, 8000);
    if (!ok) return { ok: false };
    delete DB._livePush;
    return { ok: true, pushedProjectCount: projects.length, pushedTaskCount: tasks.length };
  }

  return { pull, syncIntoStore, syncProjectsUp, enabled, client };
})();
