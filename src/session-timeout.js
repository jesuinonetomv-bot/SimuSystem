export const BACKGROUND_TIMEOUT_MS = 5 * 60 * 1000;
const STORAGE_KEY = "simuBackgroundSince";

// Check the timestamp again on return: Android can suspend background timers.
export function attachSessionTimeout({ page, ownerWindow, storage, active, onExpire,
  timeoutMs = BACKGROUND_TIMEOUT_MS, now = Date.now,
  schedule = setTimeout, unschedule = clearTimeout }) {
  let since = null, timer = null;
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (stored !== null && Number.isFinite(+stored) && +stored >= 0) since = +stored;
  } catch (_) {}

  function reset() {
    since = null;
    if (timer !== null) unschedule(timer);
    timer = null;
    try { storage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  function deadline() { return since === null ? null : since + timeoutMs; }

  function check() {
    if (!active()) return true;
    const expiresAt = deadline();
    if (expiresAt !== null && now() >= expiresAt) {
      reset();
      onExpire(expiresAt);
      return false;
    }
    if (page.hidden) {
      if (since === null) {
        since = now();
        try { storage.setItem(STORAGE_KEY, String(since)); } catch (_) {}
      }
      if (timer !== null) unschedule(timer);
      timer = schedule(check, Math.max(0, deadline() - now()));
    } else reset();
    return true;
  }

  function hide() {
    if (!active()) return;
    if (since === null) {
      since = now();
      try { storage.setItem(STORAGE_KEY, String(since)); } catch (_) {}
    }
    if (timer !== null) unschedule(timer);
    timer = schedule(check, Math.max(0, deadline() - now()));
  }

  function interaction(event) {
    if (!check()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  page.addEventListener("visibilitychange", check);
  page.addEventListener("pointerdown", interaction, true);
  page.addEventListener("keydown", interaction, true);
  ownerWindow.addEventListener("pagehide", hide);
  ownerWindow.addEventListener("pageshow", check);
  ownerWindow.addEventListener("focus", check);
  return { check, reset, deadline };
}
