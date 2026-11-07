/* =========================================================================
 * TT - util helpers
 * ========================================================================= */

const UTIL = {
  /* Server-agnostic "now" — in demo mode client time, in backend mode the
     backend records authoritative ISO timestamps. For the live elapsed
     counter we always compute from the session start timestamp. */
  nowISO() { return new Date().toISOString(); },

  msToClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  },

  msToHrs(ms) {
    return Math.round((ms / 3600000) * 100) / 100;
  },

  hoursToLabel(ms) {
    return `${this.msToHrs(ms)} h`;
  },

  fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  },

  fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  },

  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  uuid() { return "id" + Date.now() + "-" + Math.random().toString(36).slice(2, 8); },

  /* Attribute-style status label */
  statusBadge(status) {
    const map = { active: ["Working", "ok"], paused: ["On Break", "warn"], completed: ["Stopped", "muted"] };
    const [label, cls] = map[status] || [status, "muted"];
    return `<span class="badge b-${cls}">${UTIL.esc(label)}</span>`;
  },

  loadJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  },
  saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  },
};
