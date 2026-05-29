/* ============================================================
   H20 Meetingroom — App state (async REST)
   Praat met de Node/Express + MySQL backend via /api/...
   API-oppervlak (window.H20) blijft identiek aan de localStorage-versie,
   alleen de methoden zijn nu async (Promises).
   ============================================================ */

const ROOMS = {
  aquarium: { id: 'aquarium', name: 'Aquarium',    subtitle: 'Glazen ruimte · 1e verdieping' },
  bundled:  { id: 'bundled',  name: 'Bundled',     subtitle: 'Brainstormruimte · 1e verdieping' },
  lounge:   { id: 'lounge',   name: 'Lounge Café', subtitle: 'Café-zone · 1e verdieping' },
  raboroom: { id: 'raboroom', name: 'Raboroom',    subtitle: 'Vergaderruimte · 1e verdieping' },
};

const LAST_EMAIL_KEY = 'h20-last-email';
const EMAIL_DOMAINS = ['@h20.gg', '@gmail.com', '@hotmail.com', '@outlook.com'];

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
// Laatst gebruikte e-mail is puur UX en mag lokaal blijven.
function getLastEmail() { try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch { return ''; } }
function setLastEmail(v) { try { localStorage.setItem(LAST_EMAIL_KEY, v); } catch {} }

// ---------- API helper ----------
async function apiFetch(path, opts = {}) {
  const init = {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch(`/api${path}`, init);
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (json == null) return { ok: false, reason: res.ok ? 'empty-response' : 'http-' + res.status, status: res.status };
    if (json.status === undefined) json.status = res.status;
    return json;
  } catch {
    return { ok: false, reason: 'network' };
  }
}

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

// ---------- scheduling ----------
async function getScheduled(roomId) {
  const r = await apiFetch(`/rooms/${encodeURIComponent(roomId)}/scheduled`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function nextScheduledAfter(roomId, time) {
  const list = await getScheduled(roomId);
  const t = new Date(time);
  return list.find((m) => new Date(m.startAt) >= t) || null;
}

// ---------- history ----------
async function getHistory({ roomId = null, from = null, to = null } = {}) {
  const qs = new URLSearchParams();
  if (roomId) qs.set('roomId', roomId);
  if (from) qs.set('from', new Date(from).toISOString());
  if (to) qs.set('to', new Date(to).toISOString());
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const r = await apiFetch(`/history${suffix}`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function clearHistory() {
  const r = await apiFetch('/history', { method: 'DELETE' });
  return !!r.ok;
}

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
// Geeft busyUntil/startedAt terug als Date-objecten (zelfde contract als de
// oude localStorage-versie), zodat dashboard/tablet ongewijzigd blijven.
async function getRoomStatus(roomId) {
  const r = await apiFetch(`/rooms/${encodeURIComponent(roomId)}/status`);
  if (!r.ok || !r.data) return { status: 'available' };
  const d = r.data;
  if (d.status !== 'busy') return { status: 'available' };
  const now = new Date();
  const until = new Date(d.busyUntil);
  return {
    status: 'busy',
    busyUntil: until,
    startedAt: d.startedAt ? new Date(d.startedAt) : now,
    minutesLeft: typeof d.minutesLeft === 'number' ? d.minutesLeft : minutesBetween(now, until),
    title: d.title || null,
    email: d.email || '',
    name: d.name || null,
    showTitleOnScreen: !!d.showTitleOnScreen,
  };
}

// ---------- conflict checks (client-side UI-preview; server hervalideert) ----------
async function canStart(roomId, durationMin, now = new Date()) {
  const proposedEnd = new Date(now.getTime() + durationMin * 60000);
  const next = await nextScheduledAfter(roomId, now);
  if (!next) return { ok: true, maxMinutes: null };
  const nextStart = new Date(next.startAt);
  if (proposedEnd <= nextStart) return { ok: true, maxMinutes: minutesBetween(now, nextStart) };
  return { ok: false, maxMinutes: minutesBetween(now, nextStart), conflictWith: next };
}

async function canExtend(roomId, addMin) {
  const status = await getRoomStatus(roomId);
  if (status.status !== 'busy') return { ok: false, reason: 'not-busy' };
  const proposedEnd = new Date(status.busyUntil.getTime() + addMin * 60000);
  const next = await nextScheduledAfter(roomId, status.busyUntil);
  if (!next) return { ok: true, maxMinutes: null };
  const nextStart = new Date(next.startAt);
  if (proposedEnd <= nextStart) return { ok: true, maxMinutes: minutesBetween(status.busyUntil, nextStart) };
  return { ok: false, maxMinutes: minutesBetween(status.busyUntil, nextStart), conflictWith: next };
}

async function canSchedule(roomId, startAt, endAt) {
  const start = new Date(startAt), end = new Date(endAt);
  if (end <= start) return { ok: false, reason: 'invalid-range', message: 'Eindtijd moet na starttijd liggen.' };
  if (start < new Date()) return { ok: false, reason: 'past', message: 'Starttijd ligt in het verleden.' };

  const status = await getRoomStatus(roomId);
  if (status.status === 'busy') {
    const cs = status.startedAt, ce = status.busyUntil;
    if (start < ce && end > cs) {
      return { ok: false, reason: 'overlap-current', conflictWith: { startAt: cs, endAt: ce, title: status.title } };
    }
  }
  const list = await getScheduled(roomId);
  for (const m of list) {
    const ms = new Date(m.startAt), me = new Date(m.endAt);
    if (start < me && end > ms) {
      return { ok: false, reason: 'overlap-scheduled', conflictWith: m };
    }
  }
  return { ok: true };
}

// ---------- mutations ----------
async function startMeeting(roomId, durationMin, { title = null, email = null, name = null, showTitleOnScreen = false } = {}) {
  if (!isValidEmail(email)) return { ok: false, reason: 'invalid-email' };
  const r = await apiFetch(`/rooms/${encodeURIComponent(roomId)}/start`, {
    method: 'POST',
    body: { durationMin, title, email: email.trim(), name: name ? String(name).trim() : null, showTitleOnScreen: !!(showTitleOnScreen && title) },
  });
  if (r.ok) setLastEmail(email.trim());
  return r;
}

async function extendMeeting(roomId, addMin) {
  const r = await apiFetch(`/rooms/${encodeURIComponent(roomId)}/extend`, { method: 'POST', body: { addMin } });
  if (r.ok && r.newEnd) return { ok: true, newEnd: new Date(r.newEnd) };
  return r;
}

async function endMeeting(roomId) {
  return apiFetch(`/rooms/${encodeURIComponent(roomId)}/end`, { method: 'POST' });
}

async function scheduleMeeting(roomId, { startAt, endAt, title, email, name, showTitleOnScreen = false }) {
  if (!isValidEmail(email)) return { ok: false, reason: 'invalid-email' };
  const r = await apiFetch(`/rooms/${encodeURIComponent(roomId)}/schedule`, {
    method: 'POST',
    body: {
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      title: title || null,
      email: email.trim(),
      name: name ? String(name).trim() : null,
      showTitleOnScreen: !!(showTitleOnScreen && title),
    },
  });
  if (r.ok) setLastEmail(email.trim());
  return r;
}

async function cancelScheduled(roomId, meetingId) {
  const r = await apiFetch(`/rooms/${encodeURIComponent(roomId)}/scheduled/${encodeURIComponent(meetingId)}`, { method: 'DELETE' });
  return !!r.ok;
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
  apiFetch,
  fmtTime, fmtDate, fmtDateShort, minutesBetween,
  isValidEmail, getLastEmail, setLastEmail,
  getRoomStatus, getScheduled, nextScheduledAfter,
  canStart, canExtend, canSchedule,
  startMeeting, extendMeeting, endMeeting,
  scheduleMeeting, cancelScheduled,
  getHistory, clearHistory, historyToCsv,
  toast, startClock,
};
