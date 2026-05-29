/* ============================================================
   H20 Meetingroom — Kiosk-bescherming voor de tablet
   ============================================================ */

const KIOSK_CONFIG_KEY = 'h20-kiosk-config';
const DEFAULT_PIN = '2026';

function loadKioskConfig() {
  try {
    const raw = localStorage.getItem(KIOSK_CONFIG_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {}
  return defaults();
}
function defaults() {
  return { enabled: true, exitPin: DEFAULT_PIN, wakeLock: true, longPressMs: 3000 };
}
function saveKioskConfig(cfg) {
  localStorage.setItem(KIOSK_CONFIG_KEY, JSON.stringify(cfg));
}

// ---------- Fullscreen ----------
async function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) return;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch { /* user gesture may be required */ }
}

// ---------- Wake lock ----------
let _wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return false;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    return true;
  } catch { return false; }
}

// ---------- Anti-escape ----------
function installAntiEscape() {
  // Prevent right-click menu
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // Prevent dangerous shortcuts
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (k === 'f5' || (ctrl && k === 'r')) e.preventDefault();          // reload
    if (k === 'f11') return;                                             // allow fullscreen toggle internally
    if (ctrl && (k === 'w' || k === 't' || k === 'n')) e.preventDefault();
    if (ctrl && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) e.preventDefault();
    if (k === 'f12') e.preventDefault();
    if (e.altKey && k === 'f4') e.preventDefault();
  });

  // Trap history back-swipe
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => history.pushState(null, '', location.href));

  // Prevent text selection drag-drop weirdness
  window.addEventListener('dragstart', (e) => e.preventDefault());

  // Return to fullscreen when user accidentally exits
  document.addEventListener('fullscreenchange', () => {
    const cfg = loadKioskConfig();
    if (!cfg.enabled) return;
    if (!document.fullscreenElement) {
      // try silently — needs user gesture but worth attempting
      setTimeout(enterFullscreen, 300);
    }
  });
}

// ---------- Exit PIN ----------
let _pressTimer = null;
function installExitTrigger(triggerEl) {
  if (!triggerEl) return;
  const start = () => {
    const cfg = loadKioskConfig();
    _pressTimer = setTimeout(() => promptExit(), cfg.longPressMs);
  };
  const cancel = () => { if (_pressTimer) { clearTimeout(_pressTimer); _pressTimer = null; } };
  triggerEl.addEventListener('mousedown', start);
  triggerEl.addEventListener('touchstart', start, { passive: true });
  triggerEl.addEventListener('mouseup', cancel);
  triggerEl.addEventListener('mouseleave', cancel);
  triggerEl.addEventListener('touchend', cancel);
  triggerEl.addEventListener('touchcancel', cancel);
}

function promptExit() {
  const cfg = loadKioskConfig();
  const overlay = document.createElement('div');
  overlay.className = 'kiosk-pin-overlay';
  overlay.innerHTML = `
    <div class="kiosk-pin">
      <h2>Kiosk-mode verlaten</h2>
      <p>Voer de admin-PIN in om de tablet vrij te geven.</p>
      <input type="password" inputmode="numeric" pattern="[0-9]*" id="kioskPinInput" placeholder="PIN" autocomplete="off" />
      <div class="kiosk-pin__actions">
        <button class="btn btn-ghost" id="kioskPinCancel">Annuleren</button>
        <button class="btn btn-primary" id="kioskPinSubmit">Ontgrendelen</button>
      </div>
      <div class="kiosk-pin__error" id="kioskPinError" style="display:none;">Onjuiste PIN.</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#kioskPinInput');
  setTimeout(() => input.focus(), 50);

  const close = () => overlay.remove();
  overlay.querySelector('#kioskPinCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const submit = () => {
    if (input.value === cfg.exitPin) {
      overlay.querySelector('.kiosk-pin').innerHTML = `
        <h2>Ontgrendeld</h2>
        <p>Je kunt nu de browser sluiten of een andere pagina openen.</p>
        <div class="kiosk-pin__actions">
          <button class="btn btn-primary" id="kioskPinClose">OK</button>
        </div>
      `;
      overlay.querySelector('#kioskPinClose').addEventListener('click', () => {
        // Mark kiosk temporarily disabled for this tab
        sessionStorage.setItem('h20-kiosk-unlocked', '1');
        close();
        if (document.fullscreenElement) document.exitFullscreen?.();
      });
    } else {
      overlay.querySelector('#kioskPinError').style.display = 'block';
      input.value = '';
      input.focus();
    }
  };
  overlay.querySelector('#kioskPinSubmit').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

// ---------- Public init ----------
function initKiosk({ exitTrigger } = {}) {
  const cfg = loadKioskConfig();
  if (!cfg.enabled) return;
  if (sessionStorage.getItem('h20-kiosk-unlocked')) return;

  installAntiEscape();
  if (cfg.wakeLock) requestWakeLock();
  if (exitTrigger) installExitTrigger(exitTrigger);

  // Enter fullscreen on first user interaction (browsers require gesture)
  const tryEnter = () => { enterFullscreen(); };
  window.addEventListener('pointerdown', tryEnter, { once: true });
  window.addEventListener('keydown', tryEnter, { once: true });

  // Re-acquire wake lock on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cfg.wakeLock && !_wakeLock) {
      requestWakeLock();
    }
  });
}

window.Kiosk = {
  DEFAULT_PIN,
  loadKioskConfig, saveKioskConfig,
  initKiosk, enterFullscreen, promptExit,
};
