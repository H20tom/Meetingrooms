/* ============================================================
   H20 Meetingroom — Demo / Mock State
   In productie wordt dit vervangen door Supabase Realtime / WebSocket.
   API-oppervlak blijft identiek — alleen de transport-laag wisselt.
   ============================================================ */

const ROOMS = {
  aquarium: { id: 'aquarium', name: 'Aquarium',    subtitle: 'Glazen ruimte · 1e verdieping' },
  bundled:  { id: 'bundled',  name: 'Bundled',     subtitle: 'Brainstormruimte · 1e verdieping' },
  lounge:   { id: 'lounge',   name: 'Lounge Café', subtitle: 'Café-zone · 1e verdieping' },
  raboroom: { id: 'raboroom', name: 'Raboroom',    subtitle: 'Vergaderruimte · 1e verdieping' },
};

const STORAGE_KEY = 'h20-meetingroom-state-v3-clean';
const LAST_EMAIL_KEY = 'h20-last-email';
const HISTORY_KEY = 'h20-meeting-history';
const EMAIL_DOMAINS = ['@h20.gg', '@gmail.com', '@hotmail.com', '@outlook.com'];

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
function getLastEmail() { try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch { return ''; } }
function setLastEmail(v) { try { localStorage.setItem(LAST_EMAIL_KEY, v); } catch {} }

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = (d) => {
  const days = ['Zondag','Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag'];
  const months = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
};
const fmtDateShort = (d) => `${pad(d.getDate())}-${pad(d.getMonth()+1)}`;
const minutesBetween = (a, b) => Math.max(0, Math.round((b - a) / 60000));
const uuid = () => 'm-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------- initial state (leeg — geen demo data meer) ----------
function defaultState() {
  return {
    raboroom: { current: null, scheduled: [] },
    aquarium: { current: null, scheduled: [] },
    bundled:  { current: null, scheduled: [] },
    lounge:   { current: null, scheduled: [] },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const s = defaultState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return s;
    }
    return JSON.parse(raw);
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // Cross-tab realtime simulation
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
}

// ---------- scheduling ----------
function getScheduled(roomId) {
  const state = loadState()[roomId];
  if (!state) return [];
  // Auto-purge ended scheduled items
  const now = new Date();
  const upcoming = (state.scheduled || []).filter(m => new Date(m.endAt) > now);
  if (upcoming.length !== (state.scheduled || []).length) {
    const all = loadState();
    all[roomId] = { ...state, scheduled: upcoming };
    saveState(all);
  }
  return upcoming.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
}

function nextScheduledAfter(roomId, time) {
  const list = getScheduled(roomId);
  return list.find(m => new Date(m.startAt) >= time) || null;
}

// Promote a scheduled meeting to "current" if its time has come
function promoteScheduledIfDue(roomId, now = new Date()) {
  const all = loadState();
  const r = all[roomId];
  if (!r) return false;
  // Skip if a current meeting is still active
  if (r.current && new Date(r.current.busyUntil) > now) return false;
  const due = (r.scheduled || []).find(m => new Date(m.startAt) <= now && new Date(m.endAt) > now);
  if (!due) return false;
  all[roomId] = {
    current: { sessionId: uuid(), startedAt: due.startAt, busyUntil: due.endAt, title: due.title || null, email: due.email || '', name: due.name || null, showTitleOnScreen: !!(due.showTitleOnScreen && due.title) },
    scheduled: r.scheduled.filter(m => m.id !== due.id),
  };
  saveState(all);
  return true;
}

// ---------- history log ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(arr) { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); }

function logSession(roomId, current, endedAt, endReason) {
  if (!current || !current.startedAt) return;
  // Dedup: if a row with same sessionId already exists, skip.
  const sid = current.sessionId || (current.startedAt + '|' + roomId);
  const history = loadHistory();
  if (history.some((r) => r.sessionId === sid)) return;
  const start = new Date(current.startedAt);
  const end = new Date(endedAt);
  const durMin = Math.max(0, Math.round((end - start) / 60000));
  const room = ROOMS[roomId];
  history.push({
    sessionId: sid,
    roomId,
    roomName: room ? room.name : roomId,
    email: current.email || '',
    title: current.title || '',
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    durationMin: durMin,
    endReason: endReason || 'ended',
    loggedAt: new Date().toISOString(),
  });
  // keep most recent 2000 sessions
  saveHistory(history.slice(-2000));
}

function getHistory({ roomId = null, from = null, to = null } = {}) {
  let list = loadHistory();
  if (roomId) list = list.filter((r) => r.roomId === roomId);
  if (from) { const f = new Date(from); list = list.filter((r) => new Date(r.startedAt) >= f); }
  if (to)   { const t = new Date(to);   list = list.filter((r) => new Date(r.startedAt) <= t); }
  return list.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function clearHistory() { saveHistory([]); }

function historyToCsv(rows, opts = {}) {
  const headers = ['Tijd','Naam','E-mail','Meeting','Locatie','Duur (min)'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const fmt = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const nameLookup = opts.nameLookup || (() => '');
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) {
    const naam = r.name || nameLookup(r.email) || '';
    lines.push([fmt(r.startedAt), naam, r.email, r.title, r.roomName, r.durationMin].map(esc).join(','));
  }
  return lines.join('\n');
}

// ---------- status ----------
function getRoomStatus(roomId, now = new Date()) {
  promoteScheduledIfDue(roomId, now);
  const state = loadState()[roomId];
  if (!state || !state.current) return { status: 'available' };
  const until = new Date(state.current.busyUntil);
  if (until <= now) {
    // expired
    logSession(roomId, state.current, until, 'auto-expired');
    const s = loadState();
    s[roomId] = { ...state, current: null };
    saveState(s);
    return { status: 'available' };
  }
  return {
    status: 'busy',
    busyUntil: until,
    startedAt: state.current.startedAt ? new Date(state.current.startedAt) : now,
    minutesLeft: minutesBetween(now, until),
    title: state.current.title || null,
  };
}

// ---------- conflict checks ----------
// canStart: check if a new meeting of `durationMin` from now fits before next scheduled slot
function canStart(roomId, durationMin, now = new Date()) {
  const proposedEnd = new Date(now.getTime() + durationMin * 60000);
  const next = nextScheduledAfter(roomId, now);
  if (!next) return { ok: true, maxMinutes: null };
  const nextStart = new Date(next.startAt);
  if (proposedEnd <= nextStart) return { ok: true, maxMinutes: minutesBetween(now, nextStart) };
  return {
    ok: false,
    maxMinutes: minutesBetween(now, nextStart),
    conflictWith: next,
  };
}

// canExtend: from current.busyUntil + addMin, must not pass next scheduled
function canExtend(roomId, addMin, now = new Date()) {
  const status = getRoomStatus(roomId, now);
  if (status.status !== 'busy') return { ok: false, reason: 'not-busy' };
  const proposedEnd = new Date(status.busyUntil.getTime() + addMin * 60000);
  const next = nextScheduledAfter(roomId, status.busyUntil);
  if (!next) return { ok: true, maxMinutes: null };
  const nextStart = new Date(next.startAt);
  if (proposedEnd <= nextStart) return { ok: true, maxMinutes: minutesBetween(status.busyUntil, nextStart) };
  return {
    ok: false,
    maxMinutes: minutesBetween(status.busyUntil, nextStart),
    conflictWith: next,
  };
}

// canSchedule: a new scheduled meeting must not overlap current or other scheduled
function canSchedule(roomId, startAt, endAt) {
  const all = loadState()[roomId];
  if (!all) return { ok: false, reason: 'no-room' };
  const start = new Date(startAt), end = new Date(endAt);
  if (end <= start) return { ok: false, reason: 'invalid-range', message: 'Eindtijd moet na starttijd liggen.' };
  if (start < new Date()) return { ok: false, reason: 'past', message: 'Starttijd ligt in het verleden.' };

  // overlap with current
  if (all.current) {
    const cs = new Date(all.current.startedAt), ce = new Date(all.current.busyUntil);
    if (start < ce && end > cs) {
      return { ok: false, reason: 'overlap-current', conflictWith: { startAt: cs, endAt: ce, title: all.current.title } };
    }
  }
  // overlap with scheduled
  for (const m of (all.scheduled || [])) {
    const ms = new Date(m.startAt), me = new Date(m.endAt);
    if (start < me && end > ms) {
      return { ok: false, reason: 'overlap-scheduled', conflictWith: m };
    }
  }
  return { ok: true };
}

// ---------- mutations ----------
function startMeeting(roomId, durationMin, { title = null, email = null, name = null, showTitleOnScreen = false } = {}) {
  if (!isValidEmail(email)) return { ok: false, reason: 'invalid-email' };
  const check = canStart(roomId, durationMin);
  if (!check.ok) return { ok: false, ...check };
  const now = new Date();
  const until = new Date(now.getTime() + durationMin * 60000);
  const sessionId = uuid();
  const s = loadState();
  s[roomId] = {
    ...s[roomId],
    current: { sessionId, startedAt: now.toISOString(), busyUntil: until.toISOString(), title, email: email.trim(), name: name ? String(name).trim() : null, showTitleOnScreen: !!(showTitleOnScreen && title) },
  };
  saveState(s);
  setLastEmail(email.trim());
  return { ok: true };
}

function extendMeeting(roomId, addMin) {
  const check = canExtend(roomId, addMin);
  if (!check.ok) return { ok: false, ...check };
  const s = loadState();
  const cur = s[roomId]?.current;
  if (!cur) return { ok: false, reason: 'not-busy' };
  const next = new Date(new Date(cur.busyUntil).getTime() + addMin * 60000);
  s[roomId] = { ...s[roomId], current: { ...cur, busyUntil: next.toISOString() } };
  saveState(s);
  return { ok: true, newEnd: next };
}

function endMeeting(roomId) {
  const s = loadState();
  const cur = s[roomId]?.current;
  if (cur) logSession(roomId, cur, new Date(), 'ended-manually');
  s[roomId] = { ...s[roomId], current: null };
  saveState(s);
}

function scheduleMeeting(roomId, { startAt, endAt, title, email, name, showTitleOnScreen = false }) {
  if (!isValidEmail(email)) return { ok: false, reason: 'invalid-email' };
  const check = canSchedule(roomId, startAt, endAt);
  if (!check.ok) return { ok: false, ...check };
  const s = loadState();
  const room = s[roomId] || { current: null, scheduled: [] };
  const meeting = {
    id: uuid(),
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(endAt).toISOString(),
    title: title || null,
    email: email.trim(),
    name: name ? String(name).trim() : null,
    showTitleOnScreen: !!(showTitleOnScreen && title),
    createdAt: new Date().toISOString(),
  };
  s[roomId] = { ...room, scheduled: [...(room.scheduled || []), meeting] };
  saveState(s);
  setLastEmail(email.trim());
  return { ok: true, meeting };
}

function cancelScheduled(roomId, meetingId) {
  const s = loadState();
  const room = s[roomId];
  if (!room) return false;
  s[roomId] = { ...room, scheduled: (room.scheduled || []).filter(m => m.id !== meetingId) };
  saveState(s);
  return true;
}

// ---------- toast ----------
function ensureToastContainer() {
  let el = document.getElementById('h20-toasts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'h20-toasts';
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function toast({ type = 'info', title = '', message = '', action = null, duration = 6000 }) {
  const container = ensureToastContainer();
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `
    <div class="toast__icon" aria-hidden="true">${type === 'error' ? '!' : type === 'warn' ? '!' : type === 'success' ? '✓' : 'i'}</div>
    <div class="toast__body">
      ${title ? `<strong class="toast__title">${title}</strong>` : ''}
      <div class="toast__msg">${message}</div>
      ${action ? `<button class="toast__action">${action.label}</button>` : ''}
    </div>
    <button class="toast__close" aria-label="Sluiten">×</button>
  `;
  container.appendChild(t);

  const remove = () => {
    t.classList.add('toast--leaving');
    setTimeout(() => t.remove(), 280);
  };

  t.querySelector('.toast__close').addEventListener('click', remove);
  if (action) {
    t.querySelector('.toast__action').addEventListener('click', () => {
      try { action.onClick(); } finally { remove(); }
    });
  }
  setTimeout(remove, duration);
  return remove;
}

// ---------- live clock ----------
function startClock(timeEl, dateEl) {
  const tick = () => {
    const now = new Date();
    if (timeEl) timeEl.textContent = fmtTime(now);
    if (dateEl) dateEl.textContent = fmtDate(now);
  };
  tick();
  setInterval(tick, 1000);
}

window.H20 = {
  ROOMS, EMAIL_DOMAINS,
  fmtTime, fmtDate, fmtDateShort, minutesBetween,
  isValidEmail, getLastEmail, setLastEmail,
  loadState, saveState,
  getRoomStatus, getScheduled, nextScheduledAfter,
  canStart, canExtend, canSchedule,
  startMeeting, extendMeeting, endMeeting,
  scheduleMeeting, cancelScheduled,
  getHistory, clearHistory, historyToCsv,
  toast, startClock,
};
