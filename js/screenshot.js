/* =========================================================================
 * TT - Browser screen capture (Screen Capture API)
 * Honest capture only:
 *  - Explicit user permission via getDisplayMedia() — browser shows the
 *    picker; this code never bypasses it.
 *  - A visible indicator whenever capture is active (video is mirrored into
 *    a small element + badge). A frame is drawn to canvas only when a real
 *    stream exists; if no frame is captured the image is NOT claimed to be
 *    a screenshot.
 *  - Stops on break / stop / permission revoke. No capture during breaks.
 * ========================================================================= */

const Screenshot = (() => {
  let stream = null;
  let captureTimer = null;
  let intervalMs = 600000; // 10 min default
  let active = false;
  let lastShot = null;
  let previewVideo = null;
  let onShot = null;        // callback(blobDataUrl, ts) — saved by caller
  let onStateChange = null; // callback({capturing:boolean, reason:string|null})

  function emit(state) { if (onStateChange) onStateChange(state); }

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  }

  async function requestPermission() {
    if (!supported()) { emit({ capturing: false, reason: "This browser does not support the Screen Capture API." }); return false; }
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" },
        audio: false,
      });
      // User revoked mid-sharing? track ends.
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopCapture(false); emit({ capturing: false, reason: "Screen share ended (permission stopped by user)." });
      });
      active = true;
      if (previewVideo) {
        previewVideo.srcObject = stream;
        previewVideo.style.display = "block";
      }
      emit({ capturing: true, reason: null });
      return true;
    } catch (e) {
      // User cancelled or permission denied — never force, never fake.
      stopCapture(true);
      emit({ capturing: false, reason: "Permission not granted (" + (e.name || e.message) + "). Screenshots are not being recorded." });
      return false;
    }
  }

  function captureFrame() {
    if (!active || !stream) return null;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return null;
    const v = document.createElement("video");
    v.srcObject = stream;
    v.muted = true;
    return new Promise((resolve) => {
      v.onloadedmetadata = () => {
        v.currentTime = 0;
        v.play().then(() => {
          requestAnimationFrame(() => {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = v.videoWidth || 1280;
              canvas.height = v.videoHeight || 720;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const url = canvas.toDataURL("image/jpeg", 0.7);
              resolve(url);
            } catch (err) { resolve(null); }
          });
        }).catch(() => resolve(null));
      };
      v.onerror = () => resolve(null);
    });
  }

  async function takeShot(shotMeta) {
    if (!active) return null;
    const url = await captureFrame();
    if (!url) return null; // no real frame -> not a screenshot
    lastShot = { ts: new Date().toISOString(), dataUrl: url };
    if (onShot && shotMeta) onShot({ dataUrl: url, ts: lastShot.ts, ...shotMeta });
    return lastShot;
  }

  function start(intervalMsValue, shotMetaProvider) {
    if (active) return;
    intervalMs = intervalMsValue || 600000;
    if (shotMetaProvider) shotMetaProvider = shotMetaProvider; // called per shot
    captureTimer = setInterval(async () => {
      if (!active) return;
      const meta = shotMetaProvider && (await shotMetaProvider()) || {};
      await takeShot(meta);
    }, intervalMs);
  }

  function stopCapture(opts) {
    const silent = opts && opts.silent;
    if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
    if (stream) {
      try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      stream = null;
    }
    if (previewVideo) { previewVideo.srcObject = null; previewVideo.style.display = "none"; }
    const was = active;
    active = false;
    if (!silent && was) emit({ capturing: false, reason: "Capture stopped." });
  }

  function isCapturing() { return active; }
  function setPreviewVideo(el) { previewVideo = el; }
  function state() { return { supported: supported(), active, lastShot }; }

  return {
    supported, requestPermission, start, stopCapture, takeShot,
    isCapturing, setPreviewVideo, state,
    setIntervalMs(v) { intervalMs = v; },
    setOnShot(fn) { onShot = fn; },
    setOnStateChange(fn) { onStateChange = fn; },
  };
})();
