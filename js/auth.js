/* =========================================================================
 * TT - Supabase auth gate (mirrors the Team Dashboard login exactly)
 * - email + password against the shared Supabase project (TT_CONFIG)
 * - gated by the 'allowed_emails' allow-list table
 * - full-screen overlay until authorized; logout button re-gates
 * Loads after assets/supabase.js + js/config.js. Exposes window.AUTH.
 * ========================================================================= */
(function () {
  'use strict';
  var cfg = (window.TT_CONFIG || {});
  var sb = null;
  var user = null;
  var onAuthorized = null; // callback(email) once gate passes

  function enabled() {
    return !!(window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  function init() {
    if (!enabled()) {
      console.warn('Supabase not configured; auth disabled.');
      return Promise.resolve(false);
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return sb.auth.getSession().then(function (res) {
      var s = res && res.data && res.data.session;
      if (s && s.user) { user = s.user; return isAllowed(user.email); }
      return false;
    });
  }

  function isAllowed(email) {
    if (!email) return Promise.resolve(false);
    return sb.from('allowed_emails').select('email').eq('email', String(email).toLowerCase()).maybeSingle()
      .then(function (r) {
        if (r.error) { console.error('allowed check', r.error.message); return false; }
        return !!r.data;
      });
  }

  function showOverlay() {
    var o = document.getElementById('authOverlay');
    if (o) { o.style.display = 'flex'; o.style.position = 'fixed'; o.style.inset = '0'; o.style.zIndex = '9999'; o.style.alignItems = 'center'; o.style.justifyContent = 'center'; }
    var d = document.getElementById('trackerView') || document.getElementById('dashView');
    if (d) d.classList.add('hidden');
  }
  function hideOverlay() {
    var o = document.getElementById('authOverlay');
    if (o) o.style.display = 'none';
  }

  function gate() {
    return init().then(function (allowed) {
      if (allowed && user) { hideOverlay(); if (onAuthorized) onAuthorized(user.email); return true; }
      // Only show the Supabase overlay when auth is actually configured;
      // otherwise leave the page's own fallback login visible.
      if (enabled()) showOverlay();
      return false;
    }).catch(function (e) { console.error('auth gate', e); if (enabled()) showOverlay(); return false; });
  }

  function signIn(email, password) {
    if (!sb) return Promise.resolve({ error: { message: 'Supabase not configured' } });
    return sb.auth.signInWithPassword({ email: email, password: password });
  }

  function signOut() {
    if (sb) sb.auth.signOut();
    user = null;
    showOverlay();
  }

  function wire() {
    // Ensure the client exists before binding the state-change listener.
    // (init()/gate() create it too, but they run AFTER wire() on load.)
    if (enabled() && !sb) {
      try { sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey); } catch (e) {}
    }
    var btn = document.getElementById('authSend');
    var input = document.getElementById('authEmail');
    var msg = document.getElementById('authMsg');
    var logout = document.getElementById('authLogoutBtn');
    var resetBtn = document.getElementById('authReset');
    var recoveryBox = document.getElementById('recoveryBox');
    var recoverySave = document.getElementById('recoverySave');
    var recoveryPass = document.getElementById('recoveryPass');
    var loginRow = function () {
      var r = [];
      if (btn) r.push(btn); if (input) r.push(input);
      if (document.getElementById('authPass')) r.push(document.getElementById('authPass'));
      if (resetBtn) r.push(resetBtn);
      return r;
    };
    var showRecovery = function () {
      if (recoveryBox) recoveryBox.style.display = 'block';
      loginRow().forEach(function (el) { if (el) el.style.display = 'none'; });
    };
    var showLogin = function () {
      if (recoveryBox) recoveryBox.style.display = 'none';
      loginRow().forEach(function (el) { if (el) el.style.display = ''; });
    };
    if (logout) logout.addEventListener('click', function () { window.AUTH.signOut(); });

    /* Agent password reset: sends a Supabase reset email. */
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        var email = (input && input.value || '').trim();
        if (!email) { if (msg) msg.textContent = 'Enter your email first.'; return; }
        resetBtn.disabled = true; if (msg) msg.textContent = 'Sending reset link…';
        if (window.AUTH.resetPassword) {
          window.AUTH.resetPassword(email).then(function (r) {
            resetBtn.disabled = false;
            if (msg) msg.textContent = (r && r.error) ? r.error.message : 'Check your inbox for the reset link.';
          });
        }
      });
    }

    /* Save the new password from the recovery (magic-link) flow. */
    if (recoverySave) {
      recoverySave.addEventListener('click', function () {
        var np = (recoveryPass && recoveryPass.value || '').trim();
        if (np.length < 6) { if (msg) msg.textContent = 'Password must be at least 6 characters.'; return; }
        recoverySave.disabled = true;
        if (msg) msg.textContent = 'Updating…';
        window.AUTH.updatePassword(np).then(function (r) {
          recoverySave.disabled = false;
          if (r && r.error) { if (msg) msg.textContent = r.error.message; return; }
          // password updated; if we have a session now we can enter the app
          recoveryPass.value = '';
          if (msg) { msg.textContent = 'Password updated. Sign in with your new password.'; }
          showLogin();
          if (recoveryBox) recoveryBox.style.display = 'none';
          // allow user to sign in fresh
          if (sb) sb.auth.signOut().then(function(){ showOverlay(); });
          /* optionally auto-enter if we have a full session:
             handled by onAuthStateChange -> normal sign-in still needed */
        });
      });
      if (recoveryPass) recoveryPass.addEventListener('keydown', function (e) { if (e.key === 'Enter') recoverySave.click(); });
    }

    if (!btn) return;
    btn.addEventListener('click', function () {
      var email = (input && input.value || '').trim();
      var passInput = document.getElementById('authPass');
      var password = (passInput && passInput.value || '').trim();
      if (!email) { if (msg) msg.textContent = 'Enter your email.'; return; }
      if (!password) { if (msg) msg.textContent = 'Enter your password.'; if (passInput) passInput.focus(); return; }
      btn.disabled = true;
      signIn(email, password).then(function (r) {
        btn.disabled = false;
        if (r.error) { if (msg) msg.textContent = r.error.message; return; }
        isAllowed(email).then(function (ok) {
          if (ok) { user = r.data && r.data.user; hideOverlay(); if (onAuthorized) onAuthorized(email); }
          else { if (msg) msg.textContent = 'This email is not authorized.'; sb.auth.signOut(); showOverlay(); }
        });
      });
    });
    // enter key route
    ['authEmail', 'authPass'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && btn) btn.click(); });
    });

    // auth state changes (refresh / magic-link / recovery)
    if (sb) sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') {
        // User clicked the email reset link; a recovering session exists.
        user = session && session.user;
        showOverlay();
        showRecovery();
        if (msg) msg.textContent = '';
        return;
      }
      if (session && session.user) {
        isAllowed(session.user.email).then(function (ok) {
          if (ok) { user = session.user; hideOverlay(); showLogin();
            if (typeof onAuthorized === 'function') onAuthorized(session.user.email); }
          else { if (msg) msg.textContent = 'This email is not authorized.'; sb.auth.signOut(); showOverlay(); }
        });
      } else {
        showOverlay(); showLogin();
      }
    });
  }

  window.AUTH = {
    init: init, gate: gate, signOut: signOut,
    enabled: enabled, getUser: function () { return user; },
    getUserEmail: function () { return user ? user.email : null; },
    setOnAuthorized: function (fn) { onAuthorized = fn; },
    resetPassword: function (email) {
      if (!sb) return Promise.resolve({ error: { message: 'Supabase not configured' } });
      return sb.auth.resetPasswordForEmail(email);
    },
    /* Sets the new password during the PASSWORD_RECOVERY (email magic link) flow. */
    updatePassword: function (newPassword) {
      if (!sb) return Promise.resolve({ error: { message: 'Supabase not configured' } });
      return sb.auth.updateUser({ password: newPassword });
    },
  };

  // auto-run gate on load and wire the form
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wire(); gate(); });
  } else {
    wire(); gate();
  }
})();
