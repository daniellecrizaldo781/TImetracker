/* =========================================================================
 * TT - Browser activity + idle measurement
 * Measures ONLY interactions observable in the browser within the page:
 *   - mouse movement (throttled)
 *   - mouse clicks
 *   - keyboard interaction COUNTS (no key content, value, clipboard, or
 *     password data is ever read or stored)
 * Computes an activity % over configurable intervals and tracks idle periods
 * against a configurable idle threshold.
 * NOTE: These figures represent in-page activity only — never presented as
 * system-wide activity.
 * ========================================================================= */

const Activity = (() => {
  let intervalMs = 60000;       // 1 min measurement interval
  let idleThresholdMs = 300000; // 5 min default
  let onSample = null;          // callback(intervalMs, wasActiveInWindow)
  let onIdleChange = null;      // callback(isIdle)
  let onStatsInterval = null;   // callback(activityStats) each flush interval

  let activeCount = 0;          // "active" intervals
  let totalCount = 0;           // total elapsed intervals
  let lastInteraction = Date.now();
  let isIdle = false;
  let idleSince = null;         // timestamp idle began
  let idleList = [];            // {start,end} completed idle periods (current session)
  let flushTimer = null;

  const FLUSH_MS = 60000;

  function markActive() {
    lastInteraction = Date.now();
    if (isIdle) {
      isIdle = false;
      idleList.push({ start: idleSince, end: Date.now() });
      idleSince = null;
      if (onIdleChange) onIdleChange(false);
    }
  }

  function bind() {
    const evts = {
      mousemove: true, mousedown: true, click: true,
      keydown: true, touchstart: true, scroll: true, wheel: true,
    };
    const handler = (e) => {
      // keydown only: count the event; never read e.key/e.value/clipboard.
      markActive();
    };
    for (const evt of Object.keys(evts)) {
      document.addEventListener(evt, handler, { passive: true });
    }
  }

  function tick() {
    totalCount++;
    const elapsed = Date.now() - lastInteraction;
    if (elapsed >= idleThresholdMs) {
      if (!isIdle && idleSince === null) {
        isIdle = true;
        idleSince = lastInteraction; // idle began when activity stopped
        if (onIdleChange) onIdleChange(true);
      }
      // this interval counts as inactive
      if (onSample) onSample(intervalMs, false);
    } else {
      activeCount++;
      if (onSample) onSample(intervalMs, true);
    }
  }

  function start() {
    bind();
    clearInterval(flushTimer);
    tick();
    setInterval(tick, intervalMs);
    if (onStatsInterval) {
      flushTimer = setInterval(() => {
        onStatsInterval({
          pct: totalCount === 0 ? 100 : Math.round((activeCount / totalCount) * 100),
          activeIntervals: activeCount,
          totalIntervals: totalCount,
          lastInteraction,
          idleList,
        });
      }, FLUSH_MS);
    }
  }

  function configure(opts) {
    if (opts.intervalMs) intervalMs = opts.intervalMs;
    if (opts.idleThresholdMs) idleThresholdMs = opts.idleThresholdMs;
  }

  function resetSession() {
    activeCount = 0; totalCount = 0; idleList = []; isIdle = false; idleSince = null; lastInteraction = Date.now();
  }

  function idleState() { return { isIdle, idleSince, idleList }; }

  return {
    start, configure, resetSession, markActive, idleState,
    setOnSample(fn) { onSample = fn; },
    setOnIdleChange(fn) { onIdleChange = fn; },
    setOnStatsInterval(fn) { onStatsInterval = fn; },
  };
})();
