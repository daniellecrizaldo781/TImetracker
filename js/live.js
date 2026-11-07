/* =========================================================================
 * TT - live.js  (Supabase data adapter)
 * Pulls the reference/people data (employees, teams, projects, tasks) from
 * the real Supabase project so the tracker shows your actual staff instead
 * of the demo seed. Used only when the current user is a Supabase authed
 * admin; otherwise the Demo Store remains the fallback.
 *
 * This is read-sync for people/reference data. Session/break/screenshot
 * records still live in the Store until the write-sync adapter is enabled.
 * ========================================================================= */

const LIVE = (() => {

  function enabled() {
    return !!(window.supabase && window.TT_CONFIG && window.TT_CONFIG.supabaseUrl && window.TT_CONFIG.supabaseAnonKey);
  }

  function client() {
    if (!enabled()) return null;
    return window.supabase.createClient(
      window.TT_CONFIG.supabaseUrl,
      window.TT_CONFIG.supabaseAnonKey
    );
  }

  /* Fetch rows; return [] on failure so callers degrade to demo Store. */
  async function fetchAll(table, select) {
    try {
      if (!enabled()) return [];
      const sb = client();
      const { data, error } = await sb.from(table).select(select || "*");
      if (error) { console.warn('LIVE fetch ' + table, error.message); return []; }
      return data || [];
    } catch (e) { console.warn('LIVE fetch ' + table, e.message); return []; }
  }

  /* Normalize a Supabase employee row into the Store's shape. */
  function mapEmployee(r) {
    return {
      id: r.id, email: r.email, full_name: r.full_name || r.email, role: r.role || 'employee',
      hourly_rate: Number(r.hourly_rate) || 0, currency: r.currency || 'PHP',
      team: r.team || '', is_active: r.is_active !== false, created_at: r.created_at,
      _src: 'supabase',
    };
  }

  /* Build the current data snapshot: people + projects + tasks. */
  async function pull() {
    const [emps, teams, projects, tasks] = await Promise.all([
      fetchAll('employees', 'id,email,full_name,role,hourly_rate,currency,team,is_active,created_at'),
      fetchAll('teams', 'id,name,created_at'),
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

  /* Merge a Supabase snapshot into the global Demo Store so every admin page
     reads from one consistent source. Keeps Store as the write layer. */
  async function syncIntoStore() {
    const snap = await pull();
    if (!snap.employees.length && !snap.projects.length) {
      const s = window.Store || window.API;
      if (s && s._raw) s._raw._liveSync = { ok: false, note: 'Supabase returned no people/projects yet (or not authed).' };
      return { ok: false, note: 'empty' };
    }
    const DB = (window.Store || window.API)._raw;

    // employees: match by email/uuid; replace demo seed entries with live ones
    snap.employees.forEach(live => {
      const existing = DB.employees.find(e => e.id === live.id || (e.email||'').toLowerCase() === (live.email||'').toLowerCase());
      if (existing) { Object.assign(existing, live); existing._src = 'supabase'; }
      else DB.employees.push(live);
    });
    // drop demo-only seed employees that are not in supabase? Keep them but mark demo.
    DB.employees.forEach(e => { if (e._src !== 'supabase') e._src = 'demo'; });

    // teams registry in settings
    if (snap.teams.length) {
      const set = DB.settings.teams = DB.settings.teams || [];
      snap.teams.forEach(t => { if (!set.some(x => x.id === t.id)) set.push(t); });
    }

    // projects + tasks: replace demo projects with the live set
    if (snap.projects.length) DB.projects = snap.projects;
    if (snap.tasks.length) DB.tasks = snap.tasks;

    DB._liveSync = { ok: true, at: new Date().toISOString(), employees: snap.employees.length, projects: snap.projects.length };
    return { ok: true, data: DB._liveSync };
  }

  return { pull, syncIntoStore, enabled, client };
})();
