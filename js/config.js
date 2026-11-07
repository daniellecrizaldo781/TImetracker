/* =========================================================================
 * TT - Time Tracker configuration
 * =========================================================================
 * BACKEND_URL: the Google Apps Script Web App endpoint (the /exec URL).
 *  - To go live: deploy backend/Code.gs as a Web App ("Anyone" for the
 *    chosen auth scope — better: "Anyone with Google account"), then paste
 *    the /exec URL here.
 *  - Leave "" to run in DEMO MODE: all tracking is stored only in this
 *    browser (localStorage) and is NOT synced to any server. DEMO MODE is
 *    for testing the UI only — it is never presented as real tracking.
 * ========================================================================= */
window.TT_CONFIG = {
  BACKEND_URL: "",
  APP_NAME: "Time Tracker",

  /* Defaults (an admin can override these in the backend once live). */
  SCREENSHOT_INTERVAL_MIN: 10,
  IDLE_THRESHOLD_MIN: 5,

  /* Demo-mode data expiry note. */
  DEMO_NOTE: "DEMO MODE — data is kept only in this browser and is NOT " +
             "synced to the company backend. Deploy the backend to go live."
};
